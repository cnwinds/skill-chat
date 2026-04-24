import type { StoredEvent } from '@skillchat/shared';
import type { AppConfig } from '../../config/env.js';
import type { SessionContextState } from './session-context-store.js';

export type ResponsesInputTextPart = {
  type: 'input_text';
  text: string;
};

export type ResponsesInputImagePart = {
  type: 'input_image';
  image_url: string;
};

export type ResponsesMessageInput = {
  role: 'user' | 'assistant';
  content: string | Array<ResponsesInputTextPart | ResponsesInputImagePart>;
};

export type ResponsesModelInputItem = Record<string, unknown>;

type BuildResponsesHistoryInputArgs = {
  config?: Pick<AppConfig, 'LLM_MAX_OUTPUT_TOKENS' | 'MODEL_CONTEXT_WINDOW_TOKENS' | 'MODEL_AUTO_COMPACT_TOKEN_LIMIT'>;
  history: StoredEvent[];
  currentMessage?: string;
  contextState?: SessionContextState | null;
  appendCurrentMessage?: boolean;
  maxTokens?: number;
  injectionStrategy?: ContextInjectionStrategy;
};

type HistoryInputCandidate = {
  role: 'user' | 'assistant';
  content: string;
  estimatedTokens: number;
};

export type BuildResponsesHistoryInputResult = {
  input: ResponsesMessageInput[];
  estimatedTokensBeforeBudget: number;
  estimatedTokensAfterBudget: number;
  didTruncateToBudget: boolean;
};

export type ContextInjectionStrategy = 'prepend' | 'before_last_user' | 'none';
export type CompactionScope = 'pre_turn' | 'mid_turn' | 'manual';

const DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS = 128_000;
const DEFAULT_CONTEXT_SAFETY_MARGIN_TOKENS = 4_096;
const DEFAULT_FILE_RESULT_MAX_TOKENS = 320;
const DEFAULT_TOOL_CALL_MAX_TOKENS = 320;
const DEFAULT_TOOL_RESULT_MAX_TOKENS = 1_200;
const DEFAULT_ERROR_EVENT_MAX_TOKENS = 240;
const DEFAULT_MESSAGE_ITEM_MAX_TOKENS = 8_000;
const COMPACTION_PROMPT_SOURCE_HEADROOM_TOKENS = 2_048;

const compactCommandPattern = /^\/compact(?:\s|$)/i;
const maintenanceCommandPattern = /^\/maintenance(?:\s|$)/i;
const compactionSummaryHeader = [
  '以下是会话压缩摘要，供你延续上下文使用。',
  '不要向用户显式暴露“压缩摘要”“内部记忆”之类字样。',
].join('\n');

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim();
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

export const estimateTextTokens = (value: string) => {
  const bytes = Buffer.byteLength(value, 'utf8');
  return Math.max(1, Math.ceil(bytes / 4));
};

export const truncateTextByEstimatedTokens = (value: string, maxTokens: number) => {
  if (maxTokens <= 0) {
    return '';
  }

  if (estimateTextTokens(value) <= maxTokens) {
    return value;
  }

  const maxBytes = Math.max(8, maxTokens * 4);
  let truncated = value;

  while (Buffer.byteLength(truncated, 'utf8') > maxBytes && truncated.length > 1) {
    const nextLength = Math.max(1, Math.floor(truncated.length * 0.85));
    truncated = truncated.slice(0, nextLength);
  }

  return `${truncated.trim()}...`;
};

export const resolveContextWindowTokens = (
  config?: Pick<AppConfig, 'MODEL_CONTEXT_WINDOW_TOKENS'>,
) => config?.MODEL_CONTEXT_WINDOW_TOKENS ?? DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS;

export const resolveContextBudgetTokens = (
  config?: Pick<AppConfig, 'LLM_MAX_OUTPUT_TOKENS' | 'MODEL_CONTEXT_WINDOW_TOKENS'>,
) => {
  const contextWindow = resolveContextWindowTokens(config);
  const outputReserve = Math.max(config?.LLM_MAX_OUTPUT_TOKENS ?? 0, 2_048);
  return Math.max(
    8_192,
    contextWindow - outputReserve - DEFAULT_CONTEXT_SAFETY_MARGIN_TOKENS,
  );
};

export const resolveAutoCompactLimitTokens = (
  config?: Pick<AppConfig, 'LLM_MAX_OUTPUT_TOKENS' | 'MODEL_CONTEXT_WINDOW_TOKENS' | 'MODEL_AUTO_COMPACT_TOKEN_LIMIT'>,
) => {
  const budget = resolveContextBudgetTokens(config);
  return Math.min(config?.MODEL_AUTO_COMPACT_TOKEN_LIMIT ?? Math.floor(budget * 0.85), budget);
};

export const resolveCompactionSourceBudgetTokens = (
  config?: Pick<AppConfig, 'LLM_MAX_OUTPUT_TOKENS' | 'MODEL_CONTEXT_WINDOW_TOKENS'>,
) => Math.max(8_192, resolveContextBudgetTokens(config) - COMPACTION_PROMPT_SOURCE_HEADROOM_TOKENS);

const createCandidate = (role: 'user' | 'assistant', content: string): HistoryInputCandidate | null => {
  const normalized = content.trim();
  if (!normalized) {
    return null;
  }

  return {
    role,
    content: normalized,
    estimatedTokens: estimateTextTokens(normalized),
  };
};

const toCompactionSummaryCandidate = (summary: string) => createCandidate(
  'assistant',
  `${compactionSummaryHeader}\n\n${summary.trim()}`,
);

export const createCompactionSummaryMessage = (summary: string): ResponsesMessageInput | null => {
  const candidate = toCompactionSummaryCandidate(summary);
  return candidate ? { role: candidate.role, content: candidate.content } : null;
};

const toMessageCandidate = (event: Extract<StoredEvent, { kind: 'message' }>) => {
  if (event.role !== 'user' && event.role !== 'assistant') {
    return null;
  }

  if (event.role === 'user' && (compactCommandPattern.test(event.content) || maintenanceCommandPattern.test(event.content))) {
    return null;
  }

  return createCandidate(
    event.role,
    truncateTextByEstimatedTokens(event.content, DEFAULT_MESSAGE_ITEM_MAX_TOKENS),
  );
};

const toToolResultCandidate = (event: Extract<StoredEvent, { kind: 'tool_result' }>) => {
  if (event.hidden) {
    return null;
  }

  const details = typeof event.content === 'string' && event.content.trim()
    ? `\n细节：${truncateTextByEstimatedTokens(normalizeWhitespace(event.content), DEFAULT_TOOL_RESULT_MAX_TOKENS)}`
    : '';

  return createCandidate(
    'assistant',
    [
      `上一轮工具结果：${event.skill}`,
      `摘要：${event.message}`,
      details,
    ].join('\n').trim(),
  );
};

const toFileCandidate = (event: Extract<StoredEvent, { kind: 'file' }>) => createCandidate(
  'assistant',
  [
    '上一轮生成了文件：',
    `名称：${event.file.displayName}`,
    `路径：${event.file.relativePath}`,
  ].join('\n'),
);

const toErrorCandidate = (event: Extract<StoredEvent, { kind: 'error' }>) => createCandidate(
  'assistant',
  `上一轮执行错误：${truncateTextByEstimatedTokens(normalizeWhitespace(event.message), DEFAULT_ERROR_EVENT_MAX_TOKENS)}`,
);

const toHistoryCandidate = (event: StoredEvent): HistoryInputCandidate | null => {
  switch (event.kind) {
    case 'message':
      return toMessageCandidate(event);
    case 'tool_result':
      return toToolResultCandidate(event);
    case 'file':
      return toFileCandidate(event);
    case 'error':
      return toErrorCandidate(event);
    default:
      return null;
  }
};

const extractResponseContentText = (content: unknown): string => {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (typeof entry === 'string') {
          return entry;
        }
        if (!isRecord(entry)) {
          return '';
        }
        if (typeof entry.text === 'string') {
          return entry.text;
        }
        if (Array.isArray(entry.content)) {
          return extractResponseContentText(entry.content);
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }

  if (isRecord(content) && typeof content.text === 'string') {
    return content.text;
  }

  return '';
};

const normalizeFunctionCallArguments = (value: unknown) => {
  if (typeof value === 'string') {
    return value;
  }

  if (value === undefined) {
    return '';
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const normalizeFunctionCallOutput = (value: unknown) => {
  const rawOutput = typeof value === 'string'
    ? value
    : value === undefined
      ? ''
      : JSON.stringify(value);

  if (!rawOutput.trim()) {
    return '';
  }

  try {
    const parsed = JSON.parse(rawOutput) as unknown;
    if (!isRecord(parsed)) {
      return rawOutput;
    }

    const segments: string[] = [];
    if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
      segments.push(`摘要：${parsed.summary.trim()}`);
    }
    if (typeof parsed.error === 'string' && parsed.error.trim()) {
      segments.push(`错误：${parsed.error.trim()}`);
    }
    if (typeof parsed.content === 'string' && parsed.content.trim()) {
      segments.push(`细节：${truncateTextByEstimatedTokens(normalizeWhitespace(parsed.content), DEFAULT_TOOL_RESULT_MAX_TOKENS)}`);
    }
    if (Array.isArray(parsed.artifacts) && parsed.artifacts.length > 0) {
      const artifacts = parsed.artifacts
        .map((artifact) => {
          if (!isRecord(artifact)) {
            return '';
          }
          const name = typeof artifact.name === 'string' ? artifact.name : '';
          const relativePath = typeof artifact.relativePath === 'string' ? artifact.relativePath : '';
          return [name, relativePath].filter(Boolean).join(' ');
        })
        .filter(Boolean);
      if (artifacts.length > 0) {
        segments.push(`产物：${artifacts.join('；')}`);
      }
    }

    return segments.join('\n').trim() || rawOutput;
  } catch {
    return rawOutput;
  }
};

const toResponsesInputCandidate = (item: ResponsesModelInputItem): HistoryInputCandidate | null => {
  if (!isRecord(item)) {
    return null;
  }

  const role = item.role === 'user' || item.role === 'assistant' ? item.role : null;
  if (role) {
    const content = extractResponseContentText(item.content);
    return createCandidate(
      role,
      truncateTextByEstimatedTokens(content, DEFAULT_MESSAGE_ITEM_MAX_TOKENS),
    );
  }

  const type = typeof item.type === 'string' ? item.type : '';
  if (type === 'function_call') {
    const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : 'unknown';
    const argumentsText = normalizeFunctionCallArguments(item.arguments);
    return createCandidate(
      'assistant',
      [
        `本轮调用了工具：${name}`,
        argumentsText.trim()
          ? `参数：${truncateTextByEstimatedTokens(normalizeWhitespace(argumentsText), DEFAULT_TOOL_CALL_MAX_TOKENS)}`
          : '',
      ].filter(Boolean).join('\n'),
    );
  }

  if (type === 'function_call_output') {
    const callId = typeof item.call_id === 'string' ? item.call_id.trim() : '';
    const outputText = normalizeFunctionCallOutput(item.output);
    return createCandidate(
      'assistant',
      [
        callId ? `本轮工具结果（${callId}）` : '本轮工具结果',
        truncateTextByEstimatedTokens(normalizeWhitespace(outputText), DEFAULT_TOOL_RESULT_MAX_TOKENS),
      ].filter(Boolean).join('\n'),
    );
  }

  return null;
};

const takeTailWithinBudget = (
  candidates: HistoryInputCandidate[],
  budgetTokens: number,
) => {
  if (budgetTokens <= 0 || candidates.length === 0) {
    return {
      items: [] as HistoryInputCandidate[],
      didTruncateToBudget: candidates.length > 0,
      estimatedTokensAfterBudget: 0,
    };
  }

  const selected: HistoryInputCandidate[] = [];
  let remaining = budgetTokens;
  let didTruncateToBudget = false;

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index]!;
    if (candidate.estimatedTokens <= remaining) {
      selected.push(candidate);
      remaining -= candidate.estimatedTokens;
      continue;
    }

    didTruncateToBudget = true;
    if (selected.length === 0 || index === candidates.length - 1) {
      const truncatedContent = truncateTextByEstimatedTokens(candidate.content, remaining);
      const truncatedCandidate = createCandidate(candidate.role, truncatedContent);
      if (truncatedCandidate) {
        selected.push(truncatedCandidate);
      }
    }
    break;
  }

  selected.reverse();

  return {
    items: selected,
    didTruncateToBudget,
    estimatedTokensAfterBudget: selected.reduce((sum, item) => sum + item.estimatedTokens, 0),
  };
};

const candidateKey = (candidate: HistoryInputCandidate) => `${candidate.role}:${candidate.content}`;

export const buildResponsesHistoryInput = (
  args: BuildResponsesHistoryInputArgs,
): BuildResponsesHistoryInputResult => {
  const maxTokens = args.maxTokens ?? resolveContextBudgetTokens(args.config);
  const appendCurrentMessage = args.appendCurrentMessage ?? true;
  const injectionStrategy = args.injectionStrategy ?? 'prepend';
  const summary = args.contextState?.latestCompaction?.summary?.trim() ?? '';
  const baselineCreatedAt = args.contextState?.latestCompaction?.baselineCreatedAt ?? null;

  const stickyCandidates = summary
    ? [toCompactionSummaryCandidate(summary)].filter((candidate): candidate is HistoryInputCandidate => Boolean(candidate))
    : [];

  const relevantHistory = baselineCreatedAt
    ? args.history.filter((event) => event.createdAt > baselineCreatedAt)
    : args.history;

  const historyCandidates = relevantHistory
    .map(toHistoryCandidate)
    .filter((candidate): candidate is HistoryInputCandidate => Boolean(candidate));

  if (appendCurrentMessage && args.currentMessage) {
    const lastCandidate = historyCandidates[historyCandidates.length - 1];
    if (!(lastCandidate?.role === 'user' && lastCandidate.content === args.currentMessage)) {
      const currentCandidate = createCandidate(
        'user',
        truncateTextByEstimatedTokens(args.currentMessage, DEFAULT_MESSAGE_ITEM_MAX_TOKENS),
      );
      if (currentCandidate) {
        historyCandidates.push(currentCandidate);
      }
    }
  }

  const stickyTokens = stickyCandidates.reduce((sum, item) => sum + item.estimatedTokens, 0);
  const variableBudget = Math.max(0, maxTokens - stickyTokens);
  const variableSelection = takeTailWithinBudget(historyCandidates, variableBudget);
  const selectedItems = variableSelection.items.map((item) => ({
    role: item.role,
    content: item.content,
  })) as ResponsesMessageInput[];

  const input = (() => {
    if (stickyCandidates.length === 0 || injectionStrategy === 'none') {
      return selectedItems;
    }

    const stickyMessages = stickyCandidates.map((item) => ({
      role: item.role,
      content: item.content,
    })) as ResponsesMessageInput[];

    if (injectionStrategy === 'before_last_user') {
      const lastUserIndex = selectedItems.map((item) => item.role).lastIndexOf('user');
      if (lastUserIndex >= 0) {
        return [
          ...selectedItems.slice(0, lastUserIndex),
          ...stickyMessages,
          ...selectedItems.slice(lastUserIndex),
        ];
      }
    }

    return [...stickyMessages, ...selectedItems];
  })();

  return {
    input,
    estimatedTokensBeforeBudget: stickyTokens + historyCandidates.reduce((sum, item) => sum + item.estimatedTokens, 0),
    estimatedTokensAfterBudget: stickyTokens + variableSelection.estimatedTokensAfterBudget,
    didTruncateToBudget: variableSelection.didTruncateToBudget,
  };
};

export const estimateResponsesInputTokens = (inputItems: ResponsesModelInputItem[]) => inputItems
  .map(toResponsesInputCandidate)
  .filter((candidate): candidate is HistoryInputCandidate => Boolean(candidate))
  .reduce((sum, candidate) => sum + candidate.estimatedTokens, 0);

export const buildResponsesCompactionInput = (args: {
  inputItems: ResponsesModelInputItem[];
  maxTokens: number;
  stickyMessages?: ResponsesMessageInput[];
}): BuildResponsesHistoryInputResult => {
  const stickyCandidates = (args.stickyMessages ?? [])
    .map((message) => createCandidate(message.role, extractResponseContentText(message.content)))
    .filter((candidate): candidate is HistoryInputCandidate => Boolean(candidate));
  const stickyKeys = new Set(stickyCandidates.map(candidateKey));

  const historyCandidates = args.inputItems
    .map(toResponsesInputCandidate)
    .filter((candidate): candidate is HistoryInputCandidate => Boolean(candidate))
    .filter((candidate) => !stickyKeys.has(candidateKey(candidate)));

  const stickyTokens = stickyCandidates.reduce((sum, item) => sum + item.estimatedTokens, 0);
  const variableBudget = Math.max(0, args.maxTokens - stickyTokens);
  const variableSelection = takeTailWithinBudget(historyCandidates, variableBudget);

  return {
    input: [...stickyCandidates, ...variableSelection.items].map((item) => ({
      role: item.role,
      content: item.content,
    })),
    estimatedTokensBeforeBudget: stickyTokens + historyCandidates.reduce((sum, item) => sum + item.estimatedTokens, 0),
    estimatedTokensAfterBudget: stickyTokens + variableSelection.estimatedTokensAfterBudget,
    didTruncateToBudget: variableSelection.didTruncateToBudget,
  };
};

export const shouldAutoCompactHistory = (args: {
  config?: Pick<AppConfig, 'LLM_MAX_OUTPUT_TOKENS' | 'MODEL_CONTEXT_WINDOW_TOKENS' | 'MODEL_AUTO_COMPACT_TOKEN_LIMIT'>;
  buildResult: BuildResponsesHistoryInputResult;
}) => (
  args.buildResult.didTruncateToBudget ||
  args.buildResult.estimatedTokensBeforeBudget >= resolveAutoCompactLimitTokens(args.config)
);

export const buildDynamicFileSection = (files: Array<{
  id: string;
  name: string;
  bucket: string;
  size: number;
  relativePath: string;
}>, toSessionToolPath: (relativePath: string) => string) => {
  if (files.length === 0) {
    return '## Session Files\n当前会话没有已上传或共享的文件。';
  }

  const prefixLines = [
    '## Session Files',
    '当前会话可见文件如下。需要读取内容或补充定位更多文件时，可以使用会话文件工具；需要把文件路径传给脚本时，优先使用这里给出的 session path。',
  ];
  const prefixTokens = estimateTextTokens(prefixLines.join('\n'));
  const previewBudget = Math.max(120, DEFAULT_FILE_RESULT_MAX_TOKENS - prefixTokens);

  const selectedLines: string[] = [];
  let usedTokens = 0;
  let hiddenCount = 0;

  for (const file of files) {
    const line = `- ${file.name} (${file.bucket}, ${file.size} bytes, id: ${file.id}, session path: ${toSessionToolPath(file.relativePath)})`;
    const lineTokens = estimateTextTokens(line);
    if (selectedLines.length > 0 && usedTokens + lineTokens > previewBudget) {
      hiddenCount += 1;
      continue;
    }
    if (selectedLines.length === 0 && lineTokens > previewBudget) {
      selectedLines.push(truncateTextByEstimatedTokens(line, previewBudget));
      hiddenCount = Math.max(0, files.length - 1);
      break;
    }
    selectedLines.push(line);
    usedTokens += lineTokens;
  }

  if (hiddenCount > 0) {
    selectedLines.push(`- 其余 ${hiddenCount} 个文件请通过 \`list_files\` 查看`);
  }

  return [...prefixLines, ...selectedLines].join('\n');
};
