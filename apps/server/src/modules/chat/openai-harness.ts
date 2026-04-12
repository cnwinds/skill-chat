import { z } from 'zod';
import type { FileRecord, SessionFileContext, StoredEvent } from '@skillchat/shared';
import type { AppConfig } from '../../config/env.js';
import { isOpenAIResponsesRecord, streamOpenAIResponsesEvents } from '../../core/llm/openai-responses.js';
import type { AssistantToolService, ExecutedAssistantToolResult } from '../tools/assistant-tool-service.js';
import type { RunnerManager } from '../../core/runner/runner-manager.js';
import type { RegisteredSkill } from '../skills/skill-registry.js';
import { buildOpenAIHarnessInstructions, toResponsesHarnessInput } from './openai-harness-prompt.js';

type JsonRecord = Record<string, unknown>;
type ResponsesInputItem = JsonRecord;

type LocalToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  supportsParallelToolCalls: boolean;
};

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
};

type PendingHarnessInput = {
  inputId: string;
  content: string;
  createdAt: string;
};

const MAX_TOOL_ROUNDS = 8;
const API_RETRY_LIMIT = 5;
const API_RETRY_DELAY_MS = 1_000;
const REPLY_STREAM_IDLE_TIMEOUT_MS = 120_000;
const TOOL_OUTPUT_CHARS = 8_000;

const runSkillSchema = z.object({
  skillName: z.string().trim().min(1, 'skillName 不能为空'),
  prompt: z.string().trim().min(1, 'prompt 不能为空'),
  arguments: z.record(z.string(), z.unknown()).optional().default({}),
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

const toFunctionTool = (tool: LocalToolDefinition) => ({
  type: 'function',
  name: tool.name,
  description: tool.description,
  parameters: tool.inputSchema,
  strict: false,
});

const buildLocalToolDefinitions = (args: {
  assistantToolsEnabled: boolean;
  runtimeSkillNames: string[];
}): LocalToolDefinition[] => {
  const definitions: LocalToolDefinition[] = args.assistantToolsEnabled
    ? [
        {
          name: 'web_search',
          description: '联网搜索最新网页信息，适合最新事实、新闻、政策、排名、就业、薪资、学校官网等问题。',
          supportsParallelToolCalls: true,
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: '搜索问题或检索意图' },
              maxResults: { type: 'number', description: '最多返回多少条结果，默认 5，最大 8' },
            },
            required: ['query'],
          },
        },
        {
          name: 'web_fetch',
          description: '抓取一个明确的网页 URL，并提取正文摘要。',
          supportsParallelToolCalls: true,
          inputSchema: {
            type: 'object',
            properties: {
              url: { type: 'string', description: '需要访问的 http/https 地址' },
              maxChars: { type: 'number', description: '正文最大字符数，默认 4000' },
            },
            required: ['url'],
          },
        },
        {
          name: 'list_files',
          description: '列出当前会话和共享空间中的文件。',
          supportsParallelToolCalls: true,
          inputSchema: {
            type: 'object',
            properties: {
              bucket: { type: 'string', enum: ['uploads', 'outputs', 'shared', 'all'] },
            },
          },
        },
        {
          name: 'read_file',
          description: '读取当前会话或共享区中的文本文件片段。',
          supportsParallelToolCalls: true,
          inputSchema: {
            type: 'object',
            properties: {
              fileId: { type: 'string', description: '文件 id，优先级高于 fileName' },
              fileName: { type: 'string', description: '文件名或部分文件名' },
              startLine: { type: 'number', description: '起始行号，可选' },
              endLine: { type: 'number', description: '结束行号，可选' },
              maxChars: { type: 'number', description: '最多读取多少字符，默认 6000' },
            },
          },
        },
        {
          name: 'list_workspace_paths',
          description: '列出当前工作区或当前会话目录中的文件与子目录。读取 skill 文件时，使用 root=workspace 并访问 skills/... 路径。',
          supportsParallelToolCalls: true,
          inputSchema: {
            type: 'object',
            properties: {
              root: { type: 'string', enum: ['workspace', 'session'] },
              path: { type: 'string', description: '相对于根目录的子路径' },
              depth: { type: 'number', description: '目录展开深度，默认 2，最大 4' },
              offset: { type: 'number', description: '分页起始位置' },
              limit: { type: 'number', description: '分页数量，默认 40，最大 120' },
            },
          },
        },
        {
          name: 'read_workspace_path_slice',
          description: '读取当前工作区或当前会话目录中的文本文件片段。读取 skill 文件时，使用 root=workspace 并传入 skills/... 相对路径。',
          supportsParallelToolCalls: true,
          inputSchema: {
            type: 'object',
            properties: {
              root: { type: 'string', enum: ['workspace', 'session'] },
              path: { type: 'string', description: '相对于根目录的文件路径' },
              startLine: { type: 'number', description: '起始行号，可选' },
              endLine: { type: 'number', description: '结束行号，可选' },
              maxChars: { type: 'number', description: '最多返回多少字符，默认 6000' },
            },
            required: ['path'],
          },
        },
        {
          name: 'write_artifact_file',
          description: '将文本内容写入当前会话 outputs 目录，生成可下载产物。',
          supportsParallelToolCalls: false,
          inputSchema: {
            type: 'object',
            properties: {
              fileName: { type: 'string', description: '要生成的文件名' },
              content: { type: 'string', description: '要写入的文本内容' },
              mimeType: { type: 'string', description: '文件 MIME 类型，可选' },
              subdir: { type: 'string', description: 'outputs 下的子目录，可选' },
            },
            required: ['fileName', 'content'],
          },
        },
      ]
    : [];

  if (args.runtimeSkillNames.length > 0) {
    definitions.push({
      name: 'run_skill',
      description: '执行一个可运行的 skill 脚本来生成 PDF、Excel、Word 等文件或完成结构化处理。',
      supportsParallelToolCalls: false,
      inputSchema: {
        type: 'object',
        properties: {
          skillName: {
            type: 'string',
            enum: args.runtimeSkillNames,
            description: '要执行的 skill 名称',
          },
          prompt: {
            type: 'string',
            description: '传递给 skill 的简短执行说明。对于 pdf/docx 这类文档型 skill，不要把“请生成...”的需求原文塞进这里。',
          },
          arguments: {
            type: 'object',
            description: '附加结构化参数。文档型 skill 优先传 title、summary、documentMarkdown、fileName 等最终内容字段。',
            properties: {
              title: {
                type: 'string',
                description: '文档标题',
              },
              summary: {
                type: 'string',
                description: '文档摘要，可选',
              },
              documentMarkdown: {
                type: 'string',
                description: '最终文档正文，推荐使用 Markdown。不要传任务说明，要传最终成稿内容。',
              },
              fileName: {
                type: 'string',
                description: '输出文件名，可选',
              },
            },
            additionalProperties: true,
          },
        },
        required: ['skillName', 'prompt'],
      },
    });
  }

  return definitions;
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

const looksLikeDocumentSpec = (value: string) => (
  /请生成|文档要求|输出到|结构建议|请在|核心观点|结尾加一句|适合.*阅读|只作.*参考/i.test(value) ||
  /\n\s*\d+\.\s/.test(value) ||
  /标题\s*[\-：:]/.test(value)
);

const hasStructuredDocumentPayload = (argumentsValue: Record<string, unknown>) => {
  if (typeof argumentsValue.documentMarkdown === 'string' && argumentsValue.documentMarkdown.trim()) {
    return true;
  }

  if (Array.isArray(argumentsValue.sections) && argumentsValue.sections.length > 0) {
    return true;
  }

  return false;
};

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

  private shouldExecuteInParallel(tool: string, definitions: LocalToolDefinition[]) {
    return definitions.some((definition) => definition.name === tool && definition.supportsParallelToolCalls);
  }

  async run(args: {
    userId: string;
    sessionId: string;
    message: string;
    history: StoredEvent[];
    files: SessionFileContext[];
    availableSkills?: RegisteredSkill[];
    signal?: AbortSignal;
    drainPendingInputs?: () => Promise<PendingHarnessInput[]>;
    startingRound?: number;
    callbacks?: HarnessCallbacks;
  }) {
    if (!this.apiKey) {
      throw new Error('OpenAI API key is not configured');
    }

    const availableSkills = args.availableSkills ?? [];
    const runtimeSkills = availableSkills.filter((skill) => skill.runtime !== 'chat').map((skill) => skill.name);
    const localTools = buildLocalToolDefinitions({
      assistantToolsEnabled: this.config.ENABLE_ASSISTANT_TOOLS,
      runtimeSkillNames: runtimeSkills,
    });
    const tools = localTools.map(toFunctionTool);

    const instructions = buildOpenAIHarnessInstructions({
      config: this.config,
      files: args.files,
      availableSkills,
    });

    let inputItems: ResponsesInputItem[] = toResponsesHarnessInput(args.history, args.message) as unknown as ResponsesInputItem[];
    const finalTextChunks: string[] = [];

    let roundsUsed = 0;
    const roundBase = args.startingRound ?? 1;

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      if (args.signal?.aborted) {
        throw args.signal.reason instanceof Error ? args.signal.reason : new DOMException('Turn interrupted', 'AbortError');
      }
      roundsUsed += 1;
      await args.callbacks?.onRoundStart?.(roundBase + round);
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
          inputItems = [
            ...inputItems,
            ...(roundText
              ? [{
                  role: 'assistant',
                  content: roundText,
                }]
              : []),
            ...pendingInputs.map((input) => ({
              role: 'user',
              content: input.content,
            })),
          ] as ResponsesInputItem[];
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

      inputItems = [
        ...inputItems,
        ...roundResult.completedItems.filter(shouldReplayCompletedItem),
        ...toolOutputs,
      ];
      const pendingInputs = await args.drainPendingInputs?.() ?? [];
      if (pendingInputs.length > 0) {
        inputItems = [
          ...inputItems,
          ...pendingInputs.map((input) => ({
            role: 'user',
            content: input.content,
          })),
        ] as ResponsesInputItem[];
      }
    }

    throw new Error('工具调用轮次超过上限，已中止');
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

  private async executeLocalToolCalls(args: {
    userId: string;
    sessionId: string;
    files: SessionFileContext[];
    availableSkills: RegisteredSkill[];
    localToolCalls: ParsedLocalToolCall[];
    localTools: LocalToolDefinition[];
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
    signal?: AbortSignal;
    callbacks?: HarnessCallbacks;
  }) {
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
      const result = args.call.tool === 'run_skill'
        ? await this.executeRunSkill({
          userId: args.userId,
          sessionId: args.sessionId,
          files: args.files,
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

      if (result.artifacts?.length && args.call.tool !== 'run_skill') {
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

  private async executeRunSkill(args: {
    userId: string;
    sessionId: string;
    files: SessionFileContext[];
    availableSkills: RegisteredSkill[];
    callId: string;
    rawArguments: Record<string, unknown>;
    signal?: AbortSignal;
    callbacks?: HarnessCallbacks;
  }): Promise<ExecutedAssistantToolResult> {
    if (args.signal?.aborted) {
      throw args.signal.reason instanceof Error ? args.signal.reason : new DOMException('Turn interrupted', 'AbortError');
    }
    const input = runSkillSchema.parse(args.rawArguments);
    const skill = args.availableSkills.find((item) => item.name === input.skillName);
    if (!skill) {
      throw new Error(`当前会话未启用 Skill：${input.skillName}`);
    }
    if (skill.runtime === 'chat') {
      throw new Error(`Skill ${skill.name} 不是可执行脚本类型`);
    }

    if (
      skill.name === 'pdf' &&
      !hasStructuredDocumentPayload(input.arguments) &&
      looksLikeDocumentSpec(input.prompt)
    ) {
      throw new Error('pdf Skill 需要 `arguments.documentMarkdown` 作为最终正文，不能把任务说明直接生成到 PDF。请先整理好最终内容，再重新调用 `run_skill`，同时传 `arguments.title`、`arguments.summary`、`arguments.documentMarkdown`。');
    }

    const artifacts: FileRecord[] = [];
    let lastMessage = `已执行 ${skill.name}`;

    await this.runnerManager.execute({
      userId: args.userId,
      sessionId: args.sessionId,
      skill,
      prompt: input.prompt,
      toolArguments: input.arguments,
      files: args.files.map((file) => ({
        name: file.name,
        relativePath: file.relativePath,
        mimeType: file.mimeType,
      })),
      signal: args.signal,
      onQueued: async () => {
        await args.callbacks?.onToolProgress?.({
          callId: args.callId,
          tool: 'run_skill',
          message: '任务已排队',
          status: 'queued',
        });
      },
      onProgress: async (message, percent, status) => {
        lastMessage = message;
        await args.callbacks?.onToolProgress?.({
          callId: args.callId,
          tool: 'run_skill',
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
      tool: 'run_skill',
      arguments: input,
      summary: `已执行 ${skill.name} Skill`,
      content: [
        `Skill：${skill.name}`,
        `运行时：${skill.runtime}`,
        `状态：${lastMessage}`,
        artifacts.length > 0
          ? `生成文件：\n${artifacts.map((file) => `- ${file.displayName} (${file.relativePath})`).join('\n')}`
          : '本次执行没有产生可下载文件。',
      ].join('\n\n'),
      context: JSON.stringify({
        skill: skill.name,
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
