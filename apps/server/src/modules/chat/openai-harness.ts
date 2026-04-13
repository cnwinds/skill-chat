import { z } from 'zod';
import type { FileRecord, SessionFileContext, StoredEvent } from '@skillchat/shared';
import type { AppConfig } from '../../config/env.js';
import { isOpenAIResponsesRecord, streamOpenAIResponsesEvents } from '../../core/llm/openai-responses.js';
import type { AssistantToolService, ExecutedAssistantToolResult } from '../tools/assistant-tool-service.js';
import type { RunnerManager } from '../../core/runner/runner-manager.js';
import type { RegisteredSkill } from '../skills/skill-registry.js';
import {
  buildAssistantToolCatalog,
  findAssistantToolDefinition,
  toResponsesFunctionTool,
  type AssistantToolDefinition,
} from '../tools/tool-catalog.js';
import type { SessionContextState } from './session-context-store.js';
import {
  buildResponsesCompactionInput,
  buildResponsesHistoryInput,
  createCompactionSummaryMessage,
  estimateResponsesInputTokens,
  resolveAutoCompactLimitTokens,
  resolveCompactionSourceBudgetTokens,
  type ResponsesMessageInput,
} from './openai-harness-context.js';
import { buildOpenAIHarnessInstructions, toResponsesHarnessInput } from './openai-harness-prompt.js';

type JsonRecord = Record<string, unknown>;
type ResponsesInputItem = JsonRecord;

type ParsedLocalToolCall = {
  tool: string;
  arguments: Record<string, unknown>;
  callId: string;
};

type HarnessCallbacks = {
  onRoundStart?: (round: number) => Promise<void> | void;
  onToolCall?: (event: {
    callId: string;
    tool: string;
    arguments: Record<string, unknown>;
    hidden?: boolean;
    meta?: Record<string, unknown>;
  }) => Promise<void> | void;
  onToolProgress?: (event: {
    callId: string;
    tool: string;
    message: string;
    percent?: number;
    status?: string;
    hidden?: boolean;
    meta?: Record<string, unknown>;
  }) => Promise<void> | void;
  onToolResult?: (event: {
    callId: string;
    tool: string;
    summary: string;
    content?: string;
    hidden?: boolean;
    meta?: Record<string, unknown>;
  }) => Promise<void> | void;
  onArtifact?: (file: FileRecord) => Promise<void> | void;
  onTextDelta?: (content: string) => Promise<void> | void;
  onContextCompactionStart?: (event: {
    scope: 'mid_turn';
    estimatedTokens: number;
  }) => Promise<void> | void;
};

type PendingHarnessInput = {
  inputId: string;
  content: string;
  createdAt: string;
};

const MAX_MODEL_REQUESTS_PER_TURN = 48;
const MAX_TOOL_CALLS_PER_TURN = 128;
const MAX_CONTINUATION_COMPACTIONS_PER_TURN = 8;
const API_RETRY_LIMIT = 5;
const API_RETRY_DELAY_MS = 1_000;
const REPLY_STREAM_IDLE_TIMEOUT_MS = 120_000;
const TOOL_OUTPUT_CHARS = 8_000;

const runWorkspaceScriptSchema = z.object({
  path: z.string().trim().min(1, 'path 不能为空'),
  args: z.array(z.coerce.string()).optional().default([]),
  cwdRoot: z.enum(['session', 'workspace']).optional().default('session'),
  cwdPath: z.string().trim().optional().default(''),
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const truncate = (value: string, maxChars: number) => (
  value.length > maxChars ? `${value.slice(0, maxChars)}...` : value
);

const isJsonRecord = (value: unknown): value is JsonRecord => typeof value === 'object' && value !== null;

const parseJsonArguments = (raw: unknown) => {
  if (typeof raw === 'string') {
    if (!raw.trim()) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!isJsonRecord(parsed)) {
      throw new Error('工具参数必须是 JSON object');
    }
    return parsed as Record<string, unknown>;
  }

  if (isJsonRecord(raw)) {
    return raw as Record<string, unknown>;
  }

  return {};
};

const createToolOutputPayload = (result: ExecutedAssistantToolResult) => JSON.stringify({
  summary: result.summary,
  content: truncate(result.context ?? result.content, TOOL_OUTPUT_CHARS),
  artifacts: (result.artifacts ?? []).map((file) => ({
    id: file.id,
    name: file.displayName,
    relativePath: file.relativePath,
    downloadUrl: file.downloadUrl,
  })),
});

// This provider rejects follow-up requests that replay reasoning items.
// Keep the continuation payload minimal and only feed back local function calls.
const shouldReplayCompletedItem = (item: ResponsesInputItem) => item.type === 'function_call';

const normalizeText = (value: string) => value.replace(/\n{3,}/g, '\n\n').trim();
const toUserMessageItem = (content: string): ResponsesMessageInput => ({
  role: 'user',
  content,
});

const buildCompactionInstructions = () => [
  '你是 SkillChat 的上下文压缩器。',
  '你的任务是把已有会话压缩成后续轮次可复用的高密度摘要。',
  '只输出摘要正文，不要寒暄，不要解释你在做压缩。',
  '摘要必须覆盖：',
  '1. 用户目标与当前问题',
  '2. 已确认的事实、约束、偏好和边界',
  '3. 已读取的重要文件、skill、工具结果和关键数据',
  '4. 已生成的产物',
  '5. 后续还未完成的事项',
  '6. 如果本轮已经向用户输出过部分答复，要简要说明已经说到哪里，避免后续重复',
  '如果某项没有内容就省略，不要编造。',
].join('\n');

export class OpenAIHarness {
  constructor(
    private readonly config: AppConfig,
    private readonly assistantToolService: AssistantToolService,
    private readonly runnerManager: RunnerManager,
  ) {}

  private get baseUrl() {
    return this.config.OPENAI_BASE_URL.replace(/\/+$/, '');
  }

  private get apiKey() {
    return this.config.OPENAI_API_KEY;
  }

  private buildReasoning() {
    const model = this.config.OPENAI_MODEL;
    if (!/^gpt-5|^o\d/i.test(model)) {
      return undefined;
    }

    return {
      effort: this.config.OPENAI_REASONING_EFFORT,
    };
  }

  private shouldExecuteInParallel(tool: string, definitions: AssistantToolDefinition[]) {
    return findAssistantToolDefinition(definitions, tool)?.supportsParallelToolCalls ?? false;
  }

  async run(args: {
    userId: string;
    sessionId: string;
    message: string;
    history: StoredEvent[];
    files: SessionFileContext[];
    availableSkills?: RegisteredSkill[];
    contextState?: SessionContextState | null;
    signal?: AbortSignal;
    drainPendingInputs?: () => Promise<PendingHarnessInput[]>;
    startingRound?: number;
    callbacks?: HarnessCallbacks;
  }) {
    if (!this.apiKey) {
      throw new Error('OpenAI API key is not configured');
    }

    const availableSkills = args.availableSkills ?? [];
    const localTools = buildAssistantToolCatalog({
      assistantToolsEnabled: this.config.ENABLE_ASSISTANT_TOOLS,
      webSearchMode: this.config.WEB_SEARCH_MODE,
      enabledSkillNames: availableSkills.map((skill) => skill.name),
    });
    const tools = localTools.map(toResponsesFunctionTool);

    const instructions = buildOpenAIHarnessInstructions({
      config: this.config,
      files: args.files,
      availableSkills,
    });

    let inputItems: ResponsesInputItem[] = toResponsesHarnessInput(args.history, args.message, {
      config: this.config,
      contextState: args.contextState,
    }) as unknown as ResponsesInputItem[];
    let currentTurnUserMessages: ResponsesMessageInput[] = [toUserMessageItem(args.message)];
    const finalTextChunks: string[] = [];

    let roundsUsed = 0;
    const roundBase = args.startingRound ?? 1;
    let toolCallsUsed = 0;
    let continuationCompactionsUsed = 0;

    while (true) {
      if (args.signal?.aborted) {
        throw args.signal.reason instanceof Error ? args.signal.reason : new DOMException('Turn interrupted', 'AbortError');
      }
      roundsUsed += 1;
      if (roundsUsed > MAX_MODEL_REQUESTS_PER_TURN) {
        throw new Error('单个 turn 的模型续跑次数过多，已中止');
      }
      await args.callbacks?.onRoundStart?.(roundBase + roundsUsed - 1);
      const roundResult = await this.runRound({
        instructions,
        inputItems,
        tools,
        signal: args.signal,
        callbacks: args.callbacks,
      });
      finalTextChunks.push(...roundResult.textDeltas);

      if (roundResult.localToolCalls.length === 0) {
        const pendingInputs = await args.drainPendingInputs?.() ?? [];
        if (pendingInputs.length > 0) {
          const roundText = roundResult.textDeltas.join('');
          currentTurnUserMessages = [
            ...currentTurnUserMessages,
            ...pendingInputs.map((input) => toUserMessageItem(input.content)),
          ];
          inputItems = [
            ...inputItems,
            ...(roundText
              ? [{
                  role: 'assistant',
                  content: roundText,
                }]
              : []),
            ...pendingInputs.map((input) => toUserMessageItem(input.content)),
          ] as ResponsesInputItem[];
          const continuation = await this.maybeCompactContinuationInput({
            inputItems,
            currentTurnUserMessages,
            signal: args.signal,
            callbacks: args.callbacks,
          });
          inputItems = continuation.inputItems;
          continuationCompactionsUsed += continuation.didCompact ? 1 : 0;
          if (continuationCompactionsUsed > MAX_CONTINUATION_COMPACTIONS_PER_TURN) {
            throw new Error('单个 turn 的上下文压缩次数过多，已中止');
          }
          continue;
        }
        return {
          finalText: finalTextChunks.join(''),
          roundsUsed,
        };
      }

      const toolOutputs = await this.executeLocalToolCalls({
        userId: args.userId,
        sessionId: args.sessionId,
        files: args.files,
        availableSkills,
        localToolCalls: roundResult.localToolCalls,
        localTools,
        signal: args.signal,
        callbacks: args.callbacks,
      });
      toolCallsUsed += roundResult.localToolCalls.length;
      if (toolCallsUsed > MAX_TOOL_CALLS_PER_TURN) {
        throw new Error('单个 turn 的工具调用次数过多，已中止');
      }

      const roundText = roundResult.textDeltas.join('');
      inputItems = [
        ...inputItems,
        ...(roundText
          ? [{
              role: 'assistant',
              content: roundText,
            }]
          : []),
        ...roundResult.completedItems.filter(shouldReplayCompletedItem),
        ...toolOutputs,
      ];
      const pendingInputs = await args.drainPendingInputs?.() ?? [];
      if (pendingInputs.length > 0) {
        currentTurnUserMessages = [
          ...currentTurnUserMessages,
          ...pendingInputs.map((input) => toUserMessageItem(input.content)),
        ];
        inputItems = [
          ...inputItems,
          ...pendingInputs.map((input) => toUserMessageItem(input.content)),
        ] as ResponsesInputItem[];
      }
      const continuation = await this.maybeCompactContinuationInput({
        inputItems,
        currentTurnUserMessages,
        signal: args.signal,
        callbacks: args.callbacks,
      });
      inputItems = continuation.inputItems;
      continuationCompactionsUsed += continuation.didCompact ? 1 : 0;
      if (continuationCompactionsUsed > MAX_CONTINUATION_COMPACTIONS_PER_TURN) {
        throw new Error('单个 turn 的上下文压缩次数过多，已中止');
      }
    }
  }

  async compactContext(args: {
    history: StoredEvent[];
    contextState?: SessionContextState | null;
    currentMessage?: string;
    appendCurrentMessage?: boolean;
    signal?: AbortSignal;
  }) {
    if (!this.apiKey) {
      throw new Error('OpenAI API key is not configured');
    }

    const compactionInput = buildResponsesHistoryInput({
      config: this.config,
      history: args.history,
      currentMessage: args.currentMessage,
      contextState: args.contextState,
      appendCurrentMessage: args.appendCurrentMessage ?? false,
      maxTokens: resolveCompactionSourceBudgetTokens(this.config),
    }).input as unknown as ResponsesInputItem[];

    return this.summarizeInputItems({
      inputItems: compactionInput,
      signal: args.signal,
    });
  }

  private async runRound(args: {
    instructions: string;
    inputItems: ResponsesInputItem[];
    tools: Array<Record<string, unknown>>;
    signal?: AbortSignal;
    callbacks?: HarnessCallbacks;
  }) {
    const textDeltas: string[] = [];
    const completedItems: ResponsesInputItem[] = [];
    const localToolCalls: ParsedLocalToolCall[] = [];

    await this.streamWithRetry({
      signal: args.signal,
      body: {
        model: this.config.OPENAI_MODEL,
        instructions: args.instructions,
        input: args.inputItems,
        tools: args.tools,
        parallel_tool_calls: true,
        max_output_tokens: this.config.LLM_MAX_OUTPUT_TOKENS,
        text: {
          format: {
            type: 'text',
          },
          verbosity: 'medium',
        },
        reasoning: this.buildReasoning(),
      },
      onEvent: async (event) => {
        const dataRecord = isOpenAIResponsesRecord(event.data) ? event.data : null;
        const eventItem = dataRecord && isOpenAIResponsesRecord(dataRecord.item) ? dataRecord.item : null;

        if (event.event === 'response.output_text.delta' && dataRecord && typeof dataRecord.delta === 'string') {
          textDeltas.push(dataRecord.delta);
          await args.callbacks?.onTextDelta?.(dataRecord.delta);
          return;
        }

        if (event.event !== 'response.output_item.done' || !dataRecord) {
          return;
        }

        const item = eventItem;
        if (!item || typeof item.type !== 'string') {
          return;
        }

        if (shouldReplayCompletedItem(item)) {
          completedItems.push(item);
        }

        if (item.type === 'function_call') {
          const callId = typeof item.call_id === 'string' && item.call_id
            ? item.call_id
            : typeof item.id === 'string' && item.id
              ? item.id
              : `call_${localToolCalls.length + 1}`;

          localToolCalls.push({
            tool: String(item.name ?? ''),
            arguments: parseJsonArguments(item.arguments),
            callId,
          });
        }
      },
    });

    return {
      textDeltas,
      completedItems,
      localToolCalls,
    };
  }

  private async streamWithRetry(args: {
    signal?: AbortSignal;
    body: Record<string, unknown>;
    onEvent: (event: { event: string; data: unknown }) => Promise<void>;
  }) {
    for (let attempt = 0; attempt < API_RETRY_LIMIT; attempt += 1) {
      let sawEvent = false;

      try {
        for await (const event of streamOpenAIResponsesEvents({
          apiKey: this.apiKey,
          baseUrl: this.baseUrl,
          timeoutMs: Math.max(this.config.LLM_REQUEST_TIMEOUT_MS, REPLY_STREAM_IDLE_TIMEOUT_MS),
          signal: args.signal,
          body: args.body,
        })) {
          sawEvent = true;
          await args.onEvent(event);
        }
        return;
      } catch (error) {
        const shouldRetry = !sawEvent && attempt < API_RETRY_LIMIT - 1;
        if (!shouldRetry) {
          throw error;
        }
        const delayMs = this.config.NODE_ENV === 'test' ? 0 : API_RETRY_DELAY_MS * (attempt + 1);
        await wait(delayMs);
      }
    }
  }

  private async summarizeInputItems(args: {
    inputItems: ResponsesInputItem[];
    signal?: AbortSignal;
  }) {
    if (args.inputItems.length === 0) {
      return '暂无需要压缩的上下文。';
    }

    const textDeltas: string[] = [];

    await this.streamWithRetry({
      signal: args.signal,
      body: {
        model: this.config.OPENAI_MODEL,
        instructions: buildCompactionInstructions(),
        input: args.inputItems,
        tools: [],
        max_output_tokens: Math.min(this.config.LLM_MAX_OUTPUT_TOKENS, 4_096),
        text: {
          format: {
            type: 'text',
          },
          verbosity: 'low',
        },
        reasoning: this.buildReasoning(),
      },
      onEvent: async (event) => {
        const dataRecord = isOpenAIResponsesRecord(event.data) ? event.data : null;
        if (event.event === 'response.output_text.delta' && dataRecord && typeof dataRecord.delta === 'string') {
          textDeltas.push(dataRecord.delta);
        }
      },
    });

    const summary = normalizeText(textDeltas.join(''));
    if (!summary) {
      throw new Error('上下文压缩未返回可用摘要');
    }

    return summary;
  }

  private async maybeCompactContinuationInput(args: {
    inputItems: ResponsesInputItem[];
    currentTurnUserMessages: ResponsesMessageInput[];
    signal?: AbortSignal;
    callbacks?: HarnessCallbacks;
  }): Promise<{
    inputItems: ResponsesInputItem[];
    didCompact: boolean;
  }> {
    const estimatedTokens = estimateResponsesInputTokens(args.inputItems);
    const compactLimit = resolveAutoCompactLimitTokens(this.config);

    if (estimatedTokens < compactLimit) {
      return {
        inputItems: args.inputItems,
        didCompact: false,
      };
    }

    const compactionSource = buildResponsesCompactionInput({
      inputItems: args.inputItems,
      maxTokens: resolveCompactionSourceBudgetTokens(this.config),
      stickyMessages: args.currentTurnUserMessages,
    });

    if (compactionSource.input.length === 0) {
      return {
        inputItems: args.inputItems,
        didCompact: false,
      };
    }

    await args.callbacks?.onContextCompactionStart?.({
      scope: 'mid_turn',
      estimatedTokens,
    });

    const summary = await this.summarizeInputItems({
      inputItems: compactionSource.input as ResponsesInputItem[],
      signal: args.signal,
    });
    const summaryMessage = createCompactionSummaryMessage(summary);

    return {
      inputItems: [
        ...args.currentTurnUserMessages,
        ...(summaryMessage ? [summaryMessage] : []),
      ] as ResponsesInputItem[],
      didCompact: true,
    };
  }

  private async executeLocalToolCalls(args: {
    userId: string;
    sessionId: string;
    files: SessionFileContext[];
    availableSkills: RegisteredSkill[];
    localToolCalls: ParsedLocalToolCall[];
    localTools: AssistantToolDefinition[];
    signal?: AbortSignal;
    callbacks?: HarnessCallbacks;
  }) {
    const outputs: ResponsesInputItem[] = [];

    for (let index = 0; index < args.localToolCalls.length;) {
      if (args.signal?.aborted) {
        throw args.signal.reason instanceof Error ? args.signal.reason : new DOMException('Turn interrupted', 'AbortError');
      }
      const current = args.localToolCalls[index]!;
      if (!this.shouldExecuteInParallel(current.tool, args.localTools)) {
        outputs.push(await this.executeSingleLocalToolCall({
          userId: args.userId,
          sessionId: args.sessionId,
          files: args.files,
          availableSkills: args.availableSkills,
          call: current,
          localTools: args.localTools,
          signal: args.signal,
          callbacks: args.callbacks,
        }));
        index += 1;
        continue;
      }

      let batchEnd = index;
      while (
        batchEnd < args.localToolCalls.length &&
        this.shouldExecuteInParallel(args.localToolCalls[batchEnd]!.tool, args.localTools)
      ) {
        batchEnd += 1;
      }

      const batch = args.localToolCalls.slice(index, batchEnd);
      const batchOutputs = await Promise.all(
        batch.map((call) => this.executeSingleLocalToolCall({
          userId: args.userId,
          sessionId: args.sessionId,
          files: args.files,
          availableSkills: args.availableSkills,
          call,
          localTools: args.localTools,
          signal: args.signal,
          callbacks: args.callbacks,
        })),
      );
      outputs.push(...batchOutputs);
      index = batchEnd;
    }

    return outputs;
  }

  private async executeSingleLocalToolCall(args: {
    userId: string;
    sessionId: string;
    files: SessionFileContext[];
    availableSkills: RegisteredSkill[];
    call: ParsedLocalToolCall;
    localTools: AssistantToolDefinition[];
    signal?: AbortSignal;
    callbacks?: HarnessCallbacks;
  }) {
    const toolDefinition = findAssistantToolDefinition(args.localTools, args.call.tool);
    if (!toolDefinition) {
      throw new Error(`当前轮未暴露工具：${args.call.tool}`);
    }

    if (args.signal?.aborted) {
      throw args.signal.reason instanceof Error ? args.signal.reason : new DOMException('Turn interrupted', 'AbortError');
    }
    await args.callbacks?.onToolCall?.({
      callId: args.call.callId,
      tool: args.call.tool,
      arguments: args.call.arguments,
    });
    await args.callbacks?.onToolProgress?.({
      callId: args.call.callId,
      tool: args.call.tool,
      message: '开始调用工具',
      status: 'running',
    });

    try {
      const result = toolDefinition.executionKind === 'runner'
        ? await this.executeRunWorkspaceScript({
          userId: args.userId,
          sessionId: args.sessionId,
          availableSkills: args.availableSkills,
          callId: args.call.callId,
          rawArguments: args.call.arguments,
          signal: args.signal,
          callbacks: args.callbacks,
        })
        : await this.assistantToolService.execute({
          userId: args.userId,
          sessionId: args.sessionId,
          availableSkills: args.availableSkills,
          call: {
            tool: args.call.tool,
            arguments: args.call.arguments,
          },
        });
      if (args.signal?.aborted) {
        throw args.signal.reason instanceof Error ? args.signal.reason : new DOMException('Turn interrupted', 'AbortError');
      }

      if (result.artifacts?.length && toolDefinition.executionKind !== 'runner') {
        for (const artifact of result.artifacts) {
          await args.callbacks?.onArtifact?.(artifact);
        }
      }

      await args.callbacks?.onToolResult?.({
        callId: args.call.callId,
        tool: result.tool,
        summary: result.summary,
        content: result.content,
      });

      return {
        type: 'function_call_output',
        call_id: args.call.callId,
        output: createToolOutputPayload(result),
      };
    } catch (error) {
      if (args.signal?.aborted) {
        throw error;
      }
      const message = error instanceof Error ? error.message : '工具调用失败';
      await args.callbacks?.onToolProgress?.({
        callId: args.call.callId,
        tool: args.call.tool,
        message,
        status: 'failed',
      });
      return {
        type: 'function_call_output',
        call_id: args.call.callId,
        output: JSON.stringify({
          error: message,
        }),
      };
    }
  }

  private async executeRunWorkspaceScript(args: {
    userId: string;
    sessionId: string;
    availableSkills: RegisteredSkill[];
    callId: string;
    rawArguments: Record<string, unknown>;
    signal?: AbortSignal;
    callbacks?: HarnessCallbacks;
  }): Promise<ExecutedAssistantToolResult> {
    if (args.signal?.aborted) {
      throw args.signal.reason instanceof Error ? args.signal.reason : new DOMException('Turn interrupted', 'AbortError');
    }
    const input = runWorkspaceScriptSchema.parse(args.rawArguments);
    const normalizedPath = input.path.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    const segments = normalizedPath.split('/').filter(Boolean);

    if (segments.length < 4 || segments[0] !== 'skills' || segments[2] !== 'scripts') {
      throw new Error('run_workspace_script 只允许执行已启用 skill 目录下的脚本，路径格式应为 skills/<skill>/scripts/<file>');
    }
    if (segments.some((segment) => segment.startsWith('.'))) {
      throw new Error('不允许执行隐藏路径或点文件');
    }

    const skillName = segments[1]!;
    const skill = args.availableSkills.find((item) => item.name === skillName);
    if (!skill) {
      throw new Error(`当前会话未启用 Skill：${skillName}`);
    }

    const artifacts: FileRecord[] = [];
    let lastMessage = `已执行 ${normalizedPath}`;

    await this.runnerManager.execute({
      userId: args.userId,
      sessionId: args.sessionId,
      scriptPath: normalizedPath,
      argv: input.args,
      cwdRoot: input.cwdRoot,
      cwdPath: input.cwdPath,
      signal: args.signal,
      onQueued: async () => {
        await args.callbacks?.onToolProgress?.({
          callId: args.callId,
          tool: 'run_workspace_script',
          message: '任务已排队',
          status: 'queued',
        });
      },
      onProgress: async (message, percent, status) => {
        lastMessage = message;
        await args.callbacks?.onToolProgress?.({
          callId: args.callId,
          tool: 'run_workspace_script',
          message,
          percent,
          status,
        });
      },
      onArtifact: async (file) => {
        artifacts.push(file);
        await args.callbacks?.onArtifact?.(file);
      },
    });
    if (args.signal?.aborted) {
      throw args.signal.reason instanceof Error ? args.signal.reason : new DOMException('Turn interrupted', 'AbortError');
    }

    return {
      tool: 'run_workspace_script',
      arguments: {
        ...input,
        path: normalizedPath,
      },
      summary: `已执行脚本 ${normalizedPath}`,
      content: [
        `Skill：${skill.name}`,
        `脚本：${normalizedPath}`,
        `工作目录：${input.cwdRoot}${input.cwdPath ? `/${input.cwdPath}` : ''}`,
        input.args.length > 0
          ? `参数：\n${input.args.map((value, index) => `${index + 1}. ${value}`).join('\n')}`
          : '参数：无',
        `状态：${lastMessage}`,
        artifacts.length > 0
          ? `生成文件：\n${artifacts.map((file) => `- ${file.displayName} (${file.relativePath})`).join('\n')}`
          : '本次执行没有产生可下载文件。',
      ].join('\n\n'),
      context: JSON.stringify({
        skill: skill.name,
        path: normalizedPath,
        args: input.args,
        cwdRoot: input.cwdRoot,
        cwdPath: input.cwdPath,
        status: lastMessage,
        artifacts: artifacts.map((file) => ({
          id: file.id,
          name: file.displayName,
          relativePath: file.relativePath,
        })),
      }),
      artifacts,
    };
  }
}
