import fs from 'node:fs/promises';
import path from 'node:path';
import type { StoredEvent, ToolResultEvent } from '@skillchat/shared';
import { getProjectRoot, loadConfig } from '../config/env.js';
import { SkillRegistry } from '../modules/skills/skill-registry.js';
import { buildOpenAIHarnessInstructions, toResponsesHarnessInput } from '../modules/chat/openai-harness-prompt.js';

type SessionMeta = {
  sessionId: string;
  userId: string;
  activeSkills?: string[];
};

type ProbeScenario = {
  name: string;
  instructions: string;
  input: Array<Record<string, unknown>>;
};

type ProbeResult = {
  status: number;
  ok: boolean;
  bodyPreview: string;
  requestBytes: number;
  inputChars: number;
  instructionsChars: number;
};

const DEFAULT_TIMEOUT_MS = 90_000;

const usage = () => {
  console.log([
    'Usage:',
    '  npm --workspace @skillchat/server run probe:skill-502 -- --session <sessionId> [--attempts 1]',
    '',
    'Example:',
    '  npm --workspace @skillchat/server run probe:skill-502 -- --session CdvYP6ri2ktlrm0s-pNRp',
  ].join('\n'));
};

const parseArgs = (argv: string[]) => {
  const args = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (!current?.startsWith('--')) {
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args.set(current, 'true');
      continue;
    }
    args.set(current, next);
    index += 1;
  }

  const sessionId = args.get('--session') ?? '';
  const attempts = Math.max(1, Number.parseInt(args.get('--attempts') ?? '1', 10) || 1);
  return {
    sessionId,
    attempts,
  };
};

const readJson = async <T>(filePath: string) => JSON.parse(await fs.readFile(filePath, 'utf8')) as T;

const readJsonl = async <T>(filePath: string) => {
  const raw = await fs.readFile(filePath, 'utf8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
};

const findSessionDirectory = async (dataRoot: string, sessionId: string) => {
  const usersRoot = path.join(dataRoot, 'users');
  const users = await fs.readdir(usersRoot, { withFileTypes: true });

  for (const userEntry of users) {
    if (!userEntry.isDirectory()) {
      continue;
    }

    const candidate = path.join(usersRoot, userEntry.name, 'sessions', sessionId);
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) {
        return candidate;
      }
    } catch {
      continue;
    }
  }

  throw new Error(`未找到会话目录：${sessionId}`);
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const extractWebSearchFinalItem = (content: string | undefined) => {
  if (!content) {
    return null;
  }

  const marker = 'Provider 原始返回(JSON)：';
  const markerIndex = content.indexOf(marker);
  if (markerIndex < 0) {
    return null;
  }

  const jsonPayload = content.slice(markerIndex + marker.length).trim();
  if (!jsonPayload) {
    return null;
  }

  try {
    const parsed = JSON.parse(jsonPayload) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.finalItem)) {
      return null;
    }
    return parsed.finalItem;
  } catch {
    return null;
  }
};

const extractToolContext = (event: ToolResultEvent) => {
  if (typeof event.content !== 'string' || !event.content.trim()) {
    return '';
  }

  if (event.skill === 'read_workspace_path_slice') {
    const marker = '文件内容：';
    const markerIndex = event.content.indexOf(marker);
    if (markerIndex >= 0) {
      return event.content.slice(markerIndex + marker.length).trim();
    }
  }

  return event.content.trim();
};

const truncate = (value: string, maxChars: number) => (
  value.length > maxChars ? `${value.slice(0, maxChars)}...` : value
);

const buildReplayItems = (events: StoredEvent[], options: { readToolContentChars?: number } = {}) => {
  const items: Array<Record<string, unknown>> = [];

  for (const event of events) {
    if (event.kind === 'tool_result' && event.skill === 'web_search') {
      const finalItem = extractWebSearchFinalItem(event.content);
      if (finalItem) {
        items.push(finalItem);
      }
      continue;
    }

    if (event.kind === 'tool_call' && event.skill !== 'web_search' && event.callId) {
      items.push({
        type: 'function_call',
        call_id: event.callId,
        name: event.skill,
        arguments: JSON.stringify(event.arguments ?? {}),
      });
      continue;
    }

    if (event.kind === 'tool_result' && event.skill !== 'web_search' && event.callId) {
      const rawContent = extractToolContext(event);
      const content = typeof options.readToolContentChars === 'number' && event.skill === 'read_workspace_path_slice'
        ? truncate(rawContent, options.readToolContentChars)
        : rawContent;

      items.push({
        type: 'function_call_output',
        call_id: event.callId,
        output: JSON.stringify({
          summary: event.message,
          content,
          artifacts: [],
        }),
      });
    }
  }

  return items;
};

const serializeLength = (value: unknown) => JSON.stringify(value).length;

const probeScenario = async (baseUrl: string, apiKey: string, model: string, scenario: ProbeScenario, reasoningEffort?: string) => {
  const body = {
    model,
    instructions: `${scenario.instructions}\n\n## Probe Mode\n- 你正在执行稳定性探针。\n- 不要调用任何工具。\n- 基于已有上下文直接回复 OK。`,
    input: scenario.input,
    max_output_tokens: 32,
    stream: false,
    text: {
      format: {
        type: 'text',
      },
      verbosity: 'low',
    },
    ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/responses`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const responseText = await response.text();
    return {
      status: response.status,
      ok: response.ok,
      bodyPreview: truncate(responseText.replace(/\s+/g, ' ').trim(), 400),
      requestBytes: Buffer.byteLength(JSON.stringify(body), 'utf8'),
      inputChars: serializeLength(scenario.input),
      instructionsChars: scenario.instructions.length,
    } satisfies ProbeResult;
  } finally {
    clearTimeout(timer);
  }
};

const main = async () => {
  const { sessionId, attempts } = parseArgs(process.argv.slice(2));
  if (!sessionId) {
    usage();
    process.exitCode = 1;
    return;
  }

  const cwd = getProjectRoot();
  const config = loadConfig(cwd);
  if (!config.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY 未配置');
  }

  const sessionDirectory = await findSessionDirectory(config.DATA_ROOT, sessionId);
  const meta = await readJson<SessionMeta>(path.join(sessionDirectory, 'meta.json'));
  const events = await readJsonl<StoredEvent>(path.join(sessionDirectory, 'messages.jsonl'));

  const skillRegistry = new SkillRegistry(config);
  await skillRegistry.load();
  const registeredSkills = skillRegistry.listRegistered();
  const activatedSkills = (meta.activeSkills ?? [])
    .map((skillName) => {
      try {
        return skillRegistry.get(skillName);
      } catch {
        return null;
      }
    })
    .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill));

  const messageEvents = events.filter((event): event is Extract<StoredEvent, { kind: 'message' }> => event.kind === 'message');
  const currentMessage = [...messageEvents].reverse().find((event) => event.role === 'user')?.content;
  if (!currentMessage) {
    throw new Error('会话中不存在用户消息，无法构造 probe');
  }

  const baseInput = toResponsesHarnessInput(events, currentMessage) as unknown as Array<Record<string, unknown>>;
  const firstReadToolIndex = events.findIndex((event) => event.kind === 'tool_call' && event.skill === 'read_workspace_path_slice');
  if (firstReadToolIndex < 0) {
    throw new Error('会话中未发现 read_workspace_path_slice，无法验证“读 skill 后 502”问题');
  }

  const toolReplayBeforeRead = buildReplayItems(events.slice(0, firstReadToolIndex));
  const toolReplayWithActualRead = buildReplayItems(events);
  const toolReplayWithSmallRead = buildReplayItems(events, { readToolContentChars: 256 });
  const firstWebSearchReplay = toolReplayBeforeRead.slice(0, 1);
  const localReadOnlyReplay = buildReplayItems(events.slice(firstReadToolIndex));

  const fullInstructions = buildOpenAIHarnessInstructions({
    config,
    files: [],
    skills: registeredSkills,
    activatedSkills,
  });

  const instructionsWithoutActivatedSkillPayload = buildOpenAIHarnessInstructions({
    config,
    files: [],
    skills: registeredSkills,
    activatedSkills: [],
  });

  const scenarios: ProbeScenario[] = [
    {
      name: 'history_only_full_prompt',
      instructions: fullInstructions,
      input: [...baseInput],
    },
    {
      name: 'history_only_without_activated_skill_prompt',
      instructions: instructionsWithoutActivatedSkillPayload,
      input: [...baseInput],
    },
    {
      name: 'before_read_skill_full_prompt',
      instructions: fullInstructions,
      input: [...baseInput, ...toolReplayBeforeRead],
    },
    {
      name: 'before_read_skill_without_activated_skill_prompt',
      instructions: instructionsWithoutActivatedSkillPayload,
      input: [...baseInput, ...toolReplayBeforeRead],
    },
    {
      name: 'single_web_search_item_full_prompt',
      instructions: fullInstructions,
      input: [...baseInput, ...firstWebSearchReplay],
    },
    {
      name: 'local_read_skill_only_full_prompt',
      instructions: fullInstructions,
      input: [...baseInput, ...localReadOnlyReplay],
    },
    {
      name: 'after_read_skill_small_output_full_prompt',
      instructions: fullInstructions,
      input: [...baseInput, ...toolReplayWithSmallRead],
    },
    {
      name: 'after_read_skill_actual_output_full_prompt',
      instructions: fullInstructions,
      input: [...baseInput, ...toolReplayWithActualRead],
    },
    {
      name: 'after_read_skill_actual_output_without_activated_skill_prompt',
      instructions: instructionsWithoutActivatedSkillPayload,
      input: [...baseInput, ...toolReplayWithActualRead],
    },
  ];

  console.log(`Session: ${sessionId}`);
  console.log(`Model: ${config.OPENAI_MODEL_REPLY}`);
  console.log(`Base URL: ${config.OPENAI_BASE_URL}`);
  console.log(`Attempts per scenario: ${attempts}`);
  console.log(`Activated skills: ${(meta.activeSkills ?? []).join(', ') || '(none)'}`);
  console.log('');

  for (const scenario of scenarios) {
    console.log(`=== ${scenario.name} ===`);
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const result = await probeScenario(
        config.OPENAI_BASE_URL,
        config.OPENAI_API_KEY,
        config.OPENAI_MODEL_REPLY,
        scenario,
        /^gpt-5|^o\d/i.test(config.OPENAI_MODEL_REPLY) ? config.OPENAI_REASONING_EFFORT_REPLY : undefined,
      );

      console.log([
        `attempt=${attempt}`,
        `status=${result.status}`,
        `ok=${result.ok}`,
        `requestBytes=${result.requestBytes}`,
        `instructionsChars=${result.instructionsChars}`,
        `inputChars=${result.inputChars}`,
      ].join(' '));

      if (!result.ok) {
        console.log(`bodyPreview=${result.bodyPreview}`);
      }
    }
    console.log('');
  }
};

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
