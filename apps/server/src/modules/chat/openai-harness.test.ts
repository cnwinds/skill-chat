import { describe, expect, it, vi, afterEach } from 'vitest';
import type { FileRecord } from '@skillchat/shared';
import type { AppConfig } from '../../config/env.js';
import { OpenAIHarness } from './openai-harness.js';

const createConfig = (overrides: Partial<AppConfig> = {}): AppConfig => ({
  NODE_ENV: 'test',
  PORT: 3000,
  WEB_ORIGIN: 'http://localhost:5173',
  DATA_ROOT: '/tmp/skillchat-data',
  SKILLS_ROOT: '/tmp/skillchat-data/skills',
  DB_PATH: '/tmp/skillchat-data/skillchat.sqlite',
  CWD: '/workspace/qizhi',
  INLINE_JOBS: true,
  SESSION_EXPIRES_IN: '7d',
  OPENAI_BASE_URL: 'http://example.com/v1',
  OPENAI_API_KEY: 'test-token',
  OPENAI_MODEL: 'gpt-5.4',
  WEB_SEARCH_MODE: 'live',
  OPENAI_REASONING_EFFORT: 'xhigh',
  LLM_MAX_OUTPUT_TOKENS: 4096,
  TOOL_MAX_OUTPUT_TOKENS: 3072,
  ENABLE_ASSISTANT_TOOLS: true,
  LLM_REQUEST_TIMEOUT_MS: 1_000,
  STREAM_MAX_RETRIES: 5,
  STREAM_BACKOFF_BASE_MS: 1_000,
  STREAM_BACKOFF_MULTIPLIER: 2,
  ENABLE_TOKEN_TRACKING: true,
  ENABLE_REASONING_EVENTS: false,
  IMAGE_THUMBNAIL_THRESHOLD_BYTES: 256 * 1024,
  IMAGE_THUMBNAIL_MAX_WIDTH: 640,
  IMAGE_THUMBNAIL_MAX_HEIGHT: 640,
  IMAGE_THUMBNAIL_QUALITY: 78,
  MAX_CONCURRENT_RUNS: 5,
  RUN_TIMEOUT_MS: 120_000,
  ...overrides,
});

const createResponsesStreamResponse = (events: Array<{ event: string; data: unknown }>) => new Response(
  new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      for (const item of events) {
        controller.enqueue(encoder.encode(`event: ${item.event}\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(item.data)}\n\n`));
      }
      controller.close();
    },
  }),
  {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
    },
  },
);

const zhangXuefengSkill = {
  name: 'zhangxuefeng-perspective',
  description: '以张雪峰风格给出专业和志愿建议。',
  directory: '/workspace/qizhi/skills/zhangxuefeng-perspective',
  markdown: '# 张雪峰 Perspective\n\n先读本文件，再按需读取 style-guide、core-framework、boundaries-and-sources。',
  starterPrompts: ['扮演张雪峰'],
};

const pdfSkill = {
  name: 'pdf',
  description: '生成 PDF 文件。',
  directory: '/workspace/qizhi/skills/pdf',
  markdown: '# PDF Skill\n\n生成 PDF。',
  starterPrompts: ['帮我生成 PDF'],
};

describe('OpenAIHarness', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('feeds local tool outputs back into the same Responses loop', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createResponsesStreamResponse([
        {
          event: 'response.output_item.done',
          data: {
            type: 'response.output_item.done',
            item: {
              id: 'fc_1',
              type: 'function_call',
              call_id: 'call_read_skill',
              name: 'read_workspace_path_slice',
              arguments: JSON.stringify({
                root: 'workspace',
                path: 'skills/zhangxuefeng-perspective/SKILL.md',
                startLine: 1,
                endLine: 40,
              }),
            },
          },
        },
      ]))
      .mockResolvedValueOnce(createResponsesStreamResponse([
        {
          event: 'response.output_text.delta',
          data: {
            type: 'response.output_text.delta',
            delta: '我会按张雪峰的方式来分析这个专业。',
          },
        },
      ]));

    vi.stubGlobal('fetch', fetchMock);

    const execute = vi.fn().mockResolvedValue({
      tool: 'read_workspace_path_slice',
      arguments: {
        root: 'workspace',
        path: 'skills/zhangxuefeng-perspective/SKILL.md',
      },
      summary: '已读取 zhangxuefeng skill',
      content: '文件内容：先看就业，再看城市。',
      context: '先看就业，再看城市。',
    });

    const harness = new OpenAIHarness(
      createConfig(),
      {
        execute,
      } as never,
      {} as never,
    );

    const toolCalls: string[] = [];
    const toolResults: string[] = [];
    const textDeltas: string[] = [];

    const result = await harness.run({
      userId: 'u1',
      sessionId: 's1',
      message: '扮演张雪峰帮我分析人工智能专业',
      history: [],
      files: [],
      availableSkills: [zhangXuefengSkill],
      callbacks: {
        onToolCall: ({ tool }) => {
          toolCalls.push(tool);
        },
        onToolResult: ({ summary }) => {
          toolResults.push(summary);
        },
        onTextDelta: (delta) => {
          textDeltas.push(delta);
        },
      },
    });

    expect(result.finalText).toContain('张雪峰');
    expect(toolCalls).toEqual(['read_workspace_path_slice']);
    expect(toolResults).toEqual(['已读取 zhangxuefeng skill']);
    expect(textDeltas.join('')).toContain('张雪峰');
    expect(execute).toHaveBeenCalledTimes(1);

    const firstRequest = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(String(firstRequest.instructions)).toContain('skills/zhangxuefeng-perspective/SKILL.md');
    expect(String(firstRequest.instructions)).toContain('## Enabled Skills');
    expect(String(firstRequest.instructions)).toContain('- zhangxuefeng-perspective: 以张雪峰风格给出专业和志愿建议。');
    expect(String(firstRequest.instructions)).not.toContain('- pdf: 生成 PDF 文件。');
    expect(String(firstRequest.instructions)).not.toContain('# 张雪峰风格');

    const secondRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(secondRequest.input).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'function_call_output',
        call_id: 'call_read_skill',
      }),
    ]));
  });

  it('streams text deltas before the local tool round finishes', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createResponsesStreamResponse([
        {
          event: 'response.output_text.delta',
          data: {
            type: 'response.output_text.delta',
            delta: '先看就业数据，',
          },
        },
        {
          event: 'response.output_item.done',
          data: {
            type: 'response.output_item.done',
            item: {
              id: 'fc_1',
              type: 'function_call',
              call_id: 'call_read_skill',
              name: 'read_workspace_path_slice',
              arguments: JSON.stringify({
                root: 'workspace',
                path: 'skills/zhangxuefeng-perspective/SKILL.md',
                startLine: 1,
                endLine: 40,
              }),
            },
          },
        },
      ]))
      .mockResolvedValueOnce(createResponsesStreamResponse([
        {
          event: 'response.output_text.delta',
          data: {
            type: 'response.output_text.delta',
            delta: '再给你结论。',
          },
        },
      ]));

    vi.stubGlobal('fetch', fetchMock);

    const textDeltas: string[] = [];
    const execute = vi.fn(async () => {
      expect(textDeltas).toEqual(['先看就业数据，']);
      return {
        tool: 'read_workspace_path_slice',
        arguments: {
          root: 'workspace',
          path: 'skills/zhangxuefeng-perspective/SKILL.md',
        },
        summary: '已读取 zhangxuefeng skill',
        content: '文件内容：先看就业，再看城市。',
        context: '文件内容：先看就业，再看城市。',
      };
    });

    const harness = new OpenAIHarness(
      createConfig(),
      {
        execute,
      } as never,
      {} as never,
    );

    const result = await harness.run({
      userId: 'u1',
      sessionId: 's1',
      message: '分析人工智能专业',
      history: [],
      files: [],
      availableSkills: [zhangXuefengSkill],
      callbacks: {
        onTextDelta: (delta) => {
          textDeltas.push(delta);
        },
      },
    });

    expect(result.finalText).toBe('先看就业数据，再给你结论。');
    expect(textDeltas).toEqual(['先看就业数据，', '再给你结论。']);
    expect(execute).toHaveBeenCalledTimes(1);

    const secondRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(secondRequest.input).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'assistant',
        content: '先看就业数据，',
      }),
    ]));
  });

  it('forwards reasoning deltas and token usage from response events', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createResponsesStreamResponse([
        {
          event: 'response.reasoning_summary_text.delta',
          data: {
            type: 'response.reasoning_summary_text.delta',
            delta: '先整理约束，',
            summary_index: 0,
          },
        },
        {
          event: 'response.output_text.delta',
          data: {
            type: 'response.output_text.delta',
            delta: '最终结论。',
          },
        },
        {
          event: 'response.completed',
          data: {
            type: 'response.completed',
            response: {
              usage: {
                input_tokens: 120,
                output_tokens: 45,
                total_tokens: 165,
              },
            },
          },
        },
      ]));

    vi.stubGlobal('fetch', fetchMock);

    const reasoning: Array<{ content: string; summaryIndex?: number }> = [];
    const usages: Array<{ inputTokens: number; outputTokens: number; totalTokens: number }> = [];
    const harness = new OpenAIHarness(
      createConfig({
        ENABLE_REASONING_EVENTS: true,
      }),
      {
        execute: vi.fn(),
      } as never,
      {} as never,
    );

    const result = await harness.run({
      userId: 'u1',
      sessionId: 's1',
      message: '分析一下',
      history: [],
      files: [],
      callbacks: {
        onReasoningDelta: (event) => {
          reasoning.push(event);
        },
        onTokenUsage: (usage) => {
          usages.push(usage);
        },
      },
    });

    expect(result.finalText).toBe('最终结论。');
    expect(reasoning).toEqual([{ content: '先整理约束，', summaryIndex: 0 }]);
    expect(usages).toEqual([{ inputTokens: 120, outputTokens: 45, totalTokens: 165 }]);
    expect(result.tokenUsage).toEqual({ inputTokens: 120, outputTokens: 45, totalTokens: 165 });
  });

  it('embeds uploaded image attachments into the current user message for Responses', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(createResponsesStreamResponse([
      {
        event: 'response.output_text.delta',
        data: {
          type: 'response.output_text.delta',
          delta: '我会基于图片继续编辑。',
        },
      },
    ]));

    vi.stubGlobal('fetch', fetchMock);

    const buildResponsesInputImages = vi.fn().mockResolvedValue([
      {
        type: 'input_image' as const,
        image_url: 'data:image/png;base64,abc123',
      },
    ]);

    const harness = new OpenAIHarness(
      createConfig(),
      {
        execute: vi.fn(),
      } as never,
      {} as never,
      {
        buildResponsesInputImages,
        saveResponsesImageToolResult: vi.fn(),
      } as never,
    );

    const result = await harness.run({
      userId: 'u1',
      sessionId: 's1',
      message: '参考这张图继续改',
      attachmentIds: ['img_1', 'img_1'],
      history: [],
      files: [],
    });

    expect(result.finalText).toContain('基于图片继续编辑');
    expect(buildResponsesInputImages).toHaveBeenCalledWith('u1', ['img_1']);

    const firstRequest = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    const userMessage = firstRequest.input.find((item: { role?: string }) => item.role === 'user');
    expect(userMessage).toMatchObject({
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: '参考这张图继续改',
        },
        {
          type: 'input_image',
          image_url: 'data:image/png;base64,abc123',
        },
      ],
    });
  });

  it('emits image generation callbacks when Responses returns an image_generation_call', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(createResponsesStreamResponse([
      {
        event: 'response.output_item.done',
        data: {
          type: 'response.output_item.done',
          item: {
            id: 'img_call_1',
            type: 'image_generation_call',
            result: 'base64-image-payload',
            revised_prompt: '一张更适合做横幅的海报',
          },
        },
      },
      {
        event: 'response.completed',
        data: {
          type: 'response.completed',
          response: {
            usage: {
              input_tokens: 60,
              output_tokens: 25,
              total_tokens: 85,
            },
          },
        },
      },
    ]));

    vi.stubGlobal('fetch', fetchMock);

    const generatedFile: FileRecord = {
      id: 'file_img_1',
      userId: 'u1',
      sessionId: 's1',
      displayName: 'generated-banner.png',
      relativePath: 'sessions/s1/outputs/generated-banner.png',
      mimeType: 'image/png',
      size: 2048,
      bucket: 'outputs',
      source: 'generated',
      createdAt: '2026-04-12T00:00:00.000Z',
      downloadUrl: '/api/files/file_img_1/download',
    };
    const saveResponsesImageToolResult = vi.fn().mockResolvedValue({
      file: generatedFile,
      prompt: '生成一张横版海报',
      revisedPrompt: '一张更适合做横幅的海报',
      operation: 'generate' as const,
      source: 'responses_tool' as const,
      model: 'gpt-image-2',
      inputFileIds: undefined,
    });

    const harness = new OpenAIHarness(
      createConfig(),
      {
        execute: vi.fn(),
      } as never,
      {} as never,
      {
        buildResponsesInputImages: vi.fn().mockResolvedValue([]),
        saveResponsesImageToolResult,
      } as never,
    );

    const generatedEvents: Array<{
      source: 'responses_tool';
      model: string;
      operation: 'generate' | 'edit';
      file: FileRecord;
      prompt: string;
      revisedPrompt?: string;
      inputFileIds?: string[];
    }> = [];

    const result = await harness.run({
      userId: 'u1',
      sessionId: 's1',
      message: '生成一张横版海报',
      history: [],
      files: [],
      callbacks: {
        onImageGenerated: (event) => {
          generatedEvents.push(event);
        },
      },
    });

    expect(result.finalText).toBe('');
    expect(result.tokenUsage).toEqual({ inputTokens: 60, outputTokens: 25, totalTokens: 85 });
    expect(saveResponsesImageToolResult).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'u1',
      sessionId: 's1',
      prompt: '生成一张横版海报',
      base64Image: 'base64-image-payload',
      revisedPrompt: '一张更适合做横幅的海报',
      inputFileIds: [],
    }));
    expect(generatedEvents).toEqual([
      {
        source: 'responses_tool',
        model: 'gpt-image-2',
        operation: 'generate',
        file: generatedFile,
        prompt: '生成一张横版海报',
        revisedPrompt: '一张更适合做横幅的海报',
        inputFileIds: undefined,
      },
    ]);
  });

  it('uses local web_search function tool inside the harness loop', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createResponsesStreamResponse([
        {
          event: 'response.output_item.done',
          data: {
            type: 'response.output_item.done',
            item: {
              id: 'fc_search',
              type: 'function_call',
              call_id: 'call_search',
              name: 'web_search',
              arguments: JSON.stringify({
                query: '2026 人工智能专业 就业 薪资',
                maxResults: 4,
              }),
            },
          },
        },
      ]))
      .mockResolvedValueOnce(createResponsesStreamResponse([
        {
          event: 'response.output_text.delta',
          data: {
            type: 'response.output_text.delta',
            delta: '我先查了最新数据，再给你建议。',
          },
        },
      ]));

    vi.stubGlobal('fetch', fetchMock);

    const toolCalls: Array<{ tool: string; arguments: Record<string, unknown> }> = [];
    const toolProgressMessages: string[] = [];
    const toolResults: Array<{ tool: string; summary: string; content?: string }> = [];
    const execute = vi.fn().mockResolvedValue({
      tool: 'web_search',
      arguments: {
        query: '2026 人工智能专业 就业 薪资',
        maxResults: 4,
      },
      summary: '已完成联网搜索',
      content: '搜索动作：Search\n联网搜索总结：2026 年就业仍然分化但需求存在。',
      context: '2026 年就业仍然分化但需求存在。',
    });

    const harness = new OpenAIHarness(
      createConfig(),
      {
        execute,
      } as never,
      {} as never,
    );

    const result = await harness.run({
      userId: 'u1',
      sessionId: 's1',
      message: '帮我看下人工智能专业的最新就业情况',
      history: [],
      files: [],
      availableSkills: [zhangXuefengSkill],
      callbacks: {
        onToolCall: ({ tool, arguments: toolArguments }) => {
          toolCalls.push({ tool, arguments: toolArguments });
        },
        onToolProgress: ({ message }) => {
          toolProgressMessages.push(message);
        },
        onToolResult: ({ tool, summary, content }) => {
          toolResults.push({ tool, summary, content });
        },
      },
    });

    expect(result.finalText).toContain('最新数据');
    expect(toolCalls).toEqual([
      {
        tool: 'web_search',
        arguments: {
          query: '2026 人工智能专业 就业 薪资',
          maxResults: 4,
        },
      },
    ]);
    expect(toolProgressMessages).toContain('开始调用工具');
    expect(toolResults).toEqual([
      expect.objectContaining({
        tool: 'web_search',
        summary: '已完成联网搜索',
      }),
    ]);
    expect(execute).toHaveBeenCalledTimes(1);

    const firstRequest = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(firstRequest.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'function',
        name: 'web_search',
      }),
    ]));
    expect(firstRequest.tools.some((tool: { type?: string }) => tool.type === 'web_search')).toBe(false);

    const secondRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(secondRequest.input).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'function_call_output',
        call_id: 'call_search',
      }),
    ]));
    expect(secondRequest.input.some((item: { type?: string }) => item.type === 'web_search_call')).toBe(false);
  });

  it('hides web_search from function tools when the config disables it', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(createResponsesStreamResponse([
      {
        event: 'response.output_text.delta',
        data: {
          type: 'response.output_text.delta',
          delta: '当前不会发起联网搜索。',
        },
      },
    ]));

    vi.stubGlobal('fetch', fetchMock);

    const harness = new OpenAIHarness(
      {
        ...createConfig(),
        WEB_SEARCH_MODE: 'disabled',
      },
      {
        execute: vi.fn(),
      } as never,
      {} as never,
    );

    const result = await harness.run({
      userId: 'u1',
      sessionId: 's1',
      message: '测试关闭 web_search 时的工具暴露',
      history: [],
      files: [],
      availableSkills: [zhangXuefengSkill],
    });

    expect(result.finalText).toContain('不会发起联网搜索');

    const firstRequest = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(firstRequest.tools).not.toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'web_search',
      }),
    ]));
  });

  it('drains pending steer inputs at a round boundary and continues within the same turn', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createResponsesStreamResponse([
        {
          event: 'response.output_text.delta',
          data: {
            type: 'response.output_text.delta',
            delta: '先给出第一部分分析。',
          },
        },
      ]))
      .mockResolvedValueOnce(createResponsesStreamResponse([
        {
          event: 'response.output_text.delta',
          data: {
            type: 'response.output_text.delta',
            delta: '再根据你的补充继续完善。',
          },
        },
      ]));

    vi.stubGlobal('fetch', fetchMock);

    const harness = new OpenAIHarness(
      createConfig(),
      {
        execute: vi.fn(),
      } as never,
      {} as never,
    );

    const drainPendingInputs = vi.fn()
      .mockResolvedValueOnce([
        {
          inputId: 'input_steer_1',
          content: '补充：优先看失败测试',
          createdAt: '2026-04-12T00:00:00.000Z',
        },
      ])
      .mockResolvedValueOnce([]);

    const textDeltas: string[] = [];
    const result = await harness.run({
      userId: 'u1',
      sessionId: 's1',
      message: '分析这个问题',
      history: [],
      files: [],
      drainPendingInputs,
      callbacks: {
        onTextDelta: (delta) => {
          textDeltas.push(delta);
        },
      },
    });

    expect(result.finalText).toBe('先给出第一部分分析。再根据你的补充继续完善。');
    expect(textDeltas).toEqual(['先给出第一部分分析。', '再根据你的补充继续完善。']);
    expect(drainPendingInputs).toHaveBeenCalledTimes(2);

    const secondRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(secondRequest.input).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'assistant',
        content: '先给出第一部分分析。',
      }),
      expect.objectContaining({
        role: 'user',
        content: '补充：优先看失败测试',
      }),
    ]));
  });

  it('replays only function_call items into follow-up requests', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createResponsesStreamResponse([
        {
          event: 'response.output_item.done',
          data: {
            type: 'response.output_item.done',
            item: {
              id: 'rs_1',
              type: 'reasoning',
              summary: [],
            },
          },
        },
        {
          event: 'response.output_item.done',
          data: {
            type: 'response.output_item.done',
            item: {
              id: 'ws_leaked',
              type: 'web_search_call',
              status: 'completed',
              action: {
                type: 'search',
                query: '人工智能专业 就业 2026',
              },
            },
          },
        },
        {
          event: 'response.output_item.done',
          data: {
            type: 'response.output_item.done',
            item: {
              id: 'fc_read',
              type: 'function_call',
              call_id: 'call_read_skill',
              name: 'read_workspace_path_slice',
              arguments: JSON.stringify({
                root: 'workspace',
                path: 'skills/zhangxuefeng-perspective/SKILL.md',
                startLine: 1,
                endLine: 20,
              }),
            },
          },
        },
      ]))
      .mockResolvedValueOnce(createResponsesStreamResponse([
        {
          event: 'response.output_text.delta',
          data: {
            type: 'response.output_text.delta',
            delta: '我会结合 skill 和搜索结果继续分析。',
          },
        },
      ]));

    vi.stubGlobal('fetch', fetchMock);

    const execute = vi.fn().mockResolvedValue({
      tool: 'read_workspace_path_slice',
      arguments: {
        root: 'workspace',
        path: 'skills/zhangxuefeng-perspective/SKILL.md',
      },
      summary: '已读取 skill 片段',
      content: '先看就业，再看城市。',
      context: '先看就业，再看城市。',
    });

    const harness = new OpenAIHarness(
      createConfig(),
      {
        execute,
      } as never,
      {} as never,
    );

    const result = await harness.run({
      userId: 'u1',
      sessionId: 's1',
      message: '帮我看下就业情况',
      history: [],
      files: [],
      availableSkills: [zhangXuefengSkill],
    });

    expect(result.finalText).toContain('skill');
    expect(execute).toHaveBeenCalledTimes(1);

    const secondRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(secondRequest.input.some((item: { type?: string }) => item.type === 'reasoning')).toBe(false);
    expect(secondRequest.input.some((item: { type?: string }) => item.type === 'web_search_call')).toBe(false);
    expect(secondRequest.input).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'function_call',
        call_id: 'call_read_skill',
      }),
      expect.objectContaining({
        type: 'function_call_output',
        call_id: 'call_read_skill',
      }),
    ]));
  });

  it('supports progressive skill reads from SKILL.md into top-level references', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createResponsesStreamResponse([
        {
          event: 'response.output_item.done',
          data: {
            type: 'response.output_item.done',
            item: {
              id: 'fc_read_skill',
              type: 'function_call',
              call_id: 'call_read_skill',
              name: 'read_workspace_path_slice',
              arguments: JSON.stringify({
                root: 'workspace',
                path: 'skills/zhangxuefeng-perspective/SKILL.md',
                startLine: 1,
                endLine: 80,
              }),
            },
          },
        },
      ]))
      .mockResolvedValueOnce(createResponsesStreamResponse([
        {
          event: 'response.output_item.done',
          data: {
            type: 'response.output_item.done',
            item: {
              id: 'fc_read_reference',
              type: 'function_call',
              call_id: 'call_read_reference',
              name: 'read_workspace_path_slice',
              arguments: JSON.stringify({
                root: 'workspace',
                path: 'skills/zhangxuefeng-perspective/references/core-framework.md',
                startLine: 1,
                endLine: 80,
              }),
            },
          },
        },
      ]))
      .mockResolvedValueOnce(createResponsesStreamResponse([
        {
          event: 'response.output_text.delta',
          data: {
            type: 'response.output_text.delta',
            delta: '我先看了 skill，再补充读取了专业参考资料。',
          },
        },
      ]));

    vi.stubGlobal('fetch', fetchMock);

    const execute = vi.fn()
      .mockResolvedValueOnce({
        tool: 'read_workspace_path_slice',
        arguments: {
          root: 'workspace',
          path: 'skills/zhangxuefeng-perspective/SKILL.md',
        },
        summary: '已读取 skill 定义',
        content: '先读本文件，再按需读取 references/core-framework.md。',
        context: '先读本文件，再按需读取 references/core-framework.md。',
      })
      .mockResolvedValueOnce({
        tool: 'read_workspace_path_slice',
        arguments: {
          root: 'workspace',
          path: 'skills/zhangxuefeng-perspective/references/core-framework.md',
        },
        summary: '已读取决策框架参考',
        content: '先看中位数，再看就业和城市。',
        context: '先看中位数，再看就业和城市。',
      });

    const harness = new OpenAIHarness(
      createConfig(),
      {
        execute,
      } as never,
      {} as never,
    );

    const result = await harness.run({
      userId: 'u1',
      sessionId: 's1',
      message: '扮演张雪峰，帮我分析人工智能专业值不值得报',
      history: [],
      files: [],
      availableSkills: [zhangXuefengSkill],
    });

    expect(result.finalText).toContain('补充读取了专业参考资料');
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenNthCalledWith(1, expect.objectContaining({
      call: expect.objectContaining({
        tool: 'read_workspace_path_slice',
        arguments: expect.objectContaining({
          path: 'skills/zhangxuefeng-perspective/SKILL.md',
        }),
      }),
    }));
    expect(execute).toHaveBeenNthCalledWith(2, expect.objectContaining({
      call: expect.objectContaining({
        tool: 'read_workspace_path_slice',
        arguments: expect.objectContaining({
          path: 'skills/zhangxuefeng-perspective/references/core-framework.md',
        }),
      }),
    }));

    const firstRequest = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(String(firstRequest.instructions)).not.toContain('先看中位数，再看就业和城市。');

    const secondRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(secondRequest.input).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'function_call_output',
        call_id: 'call_read_skill',
      }),
    ]));

    const thirdRequest = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(thirdRequest.input).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'function_call_output',
        call_id: 'call_read_reference',
      }),
    ]));
  });

  it('supports progressive reads from SKILL.md to top-level references and then deep research files', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createResponsesStreamResponse([
        {
          event: 'response.output_item.done',
          data: {
            type: 'response.output_item.done',
            item: {
              id: 'fc_read_skill',
              type: 'function_call',
              call_id: 'call_read_skill',
              name: 'read_workspace_path_slice',
              arguments: JSON.stringify({
                root: 'workspace',
                path: 'skills/zhangxuefeng-perspective/SKILL.md',
                startLine: 1,
                endLine: 120,
              }),
            },
          },
        },
      ]))
      .mockResolvedValueOnce(createResponsesStreamResponse([
        {
          event: 'response.output_item.done',
          data: {
            type: 'response.output_item.done',
            item: {
              id: 'fc_read_boundary_ref',
              type: 'function_call',
              call_id: 'call_read_boundary_ref',
              name: 'read_workspace_path_slice',
              arguments: JSON.stringify({
                root: 'workspace',
                path: 'skills/zhangxuefeng-perspective/references/boundaries-and-sources.md',
                startLine: 1,
                endLine: 120,
              }),
            },
          },
        },
      ]))
      .mockResolvedValueOnce(createResponsesStreamResponse([
        {
          event: 'response.output_item.done',
          data: {
            type: 'response.output_item.done',
            item: {
              id: 'fc_read_research',
              type: 'function_call',
              call_id: 'call_read_research',
              name: 'read_workspace_path_slice',
              arguments: JSON.stringify({
                root: 'workspace',
                path: 'skills/zhangxuefeng-perspective/references/research/06-timeline.md',
                startLine: 1,
                endLine: 80,
              }),
            },
          },
        },
      ]))
      .mockResolvedValueOnce(createResponsesStreamResponse([
        {
          event: 'response.output_text.delta',
          data: {
            type: 'response.output_text.delta',
            delta: '我先读了 skill 总纲，再补边界说明，最后去看时间线研究材料。',
          },
        },
      ]));

    vi.stubGlobal('fetch', fetchMock);

    const execute = vi.fn()
      .mockResolvedValueOnce({
        tool: 'read_workspace_path_slice',
        arguments: {
          root: 'workspace',
          path: 'skills/zhangxuefeng-perspective/SKILL.md',
          startLine: 1,
          endLine: 120,
        },
        summary: '已读取 skill 总纲',
        content: '先读本文件，再按需读取 boundaries-and-sources.md 和 research/06-timeline.md。',
        context: '先读本文件，再按需读取 boundaries-and-sources.md 和 research/06-timeline.md。',
      })
      .mockResolvedValueOnce({
        tool: 'read_workspace_path_slice',
        arguments: {
          root: 'workspace',
          path: 'skills/zhangxuefeng-perspective/references/boundaries-and-sources.md',
          startLine: 1,
          endLine: 120,
        },
        summary: '已读取边界与来源说明',
        content: '张雪峰已于2026年3月24日去世；涉及人物经历时继续查看 research/06-timeline.md。',
        context: '张雪峰已于2026年3月24日去世；涉及人物经历时继续查看 research/06-timeline.md。',
      })
      .mockResolvedValueOnce({
        tool: 'read_workspace_path_slice',
        arguments: {
          root: 'workspace',
          path: 'skills/zhangxuefeng-perspective/references/research/06-timeline.md',
          startLine: 1,
          endLine: 80,
        },
        summary: '已读取研究时间线',
        content: '1984 出生，2007 北漂，2026-03-24 去世。',
        context: '1984 出生，2007 北漂，2026-03-24 去世。',
      });

    const harness = new OpenAIHarness(
      createConfig(),
      {
        execute,
      } as never,
      {} as never,
    );

    const result = await harness.run({
      userId: 'u1',
      sessionId: 's1',
      message: '扮演张雪峰，结合时间线背景回答',
      history: [],
      files: [],
      availableSkills: [zhangXuefengSkill],
    });

    expect(result.finalText).toContain('先读了 skill 总纲');
    expect(execute).toHaveBeenCalledTimes(3);
    expect(execute).toHaveBeenNthCalledWith(1, expect.objectContaining({
      call: expect.objectContaining({
        tool: 'read_workspace_path_slice',
        arguments: expect.objectContaining({
          path: 'skills/zhangxuefeng-perspective/SKILL.md',
          startLine: 1,
          endLine: 120,
        }),
      }),
    }));
    expect(execute).toHaveBeenNthCalledWith(2, expect.objectContaining({
      call: expect.objectContaining({
        tool: 'read_workspace_path_slice',
        arguments: expect.objectContaining({
          path: 'skills/zhangxuefeng-perspective/references/boundaries-and-sources.md',
          startLine: 1,
          endLine: 120,
        }),
      }),
    }));
    expect(execute).toHaveBeenNthCalledWith(3, expect.objectContaining({
      call: expect.objectContaining({
        tool: 'read_workspace_path_slice',
        arguments: expect.objectContaining({
          path: 'skills/zhangxuefeng-perspective/references/research/06-timeline.md',
        }),
      }),
    }));

    const secondRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(secondRequest.input).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'function_call_output',
        call_id: 'call_read_skill',
      }),
    ]));

    const thirdRequest = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(thirdRequest.input).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'function_call_output',
        call_id: 'call_read_boundary_ref',
      }),
    ]));

    const fourthRequest = JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body));
    expect(fourthRequest.input).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'function_call_output',
        call_id: 'call_read_research',
      }),
    ]));
  });

  it('auto compacts the same turn after tool outputs exceed the continuation budget', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createResponsesStreamResponse([
        {
          event: 'response.output_text.delta',
          data: {
            type: 'response.output_text.delta',
            delta: '我先看下关键数据，',
          },
        },
        {
          event: 'response.output_item.done',
          data: {
            type: 'response.output_item.done',
            item: {
              id: 'fc_big_read',
              type: 'function_call',
              call_id: 'call_big_read',
              name: 'read_workspace_path_slice',
              arguments: JSON.stringify({
                root: 'workspace',
                path: 'skills/zhangxuefeng-perspective/SKILL.md',
                startLine: 1,
                endLine: 200,
              }),
            },
          },
        },
      ]))
      .mockResolvedValueOnce(createResponsesStreamResponse([
        {
          event: 'response.output_text.delta',
          data: {
            type: 'response.output_text.delta',
            delta: '压缩摘要：用户要分析人工智能专业，已读取大量 skill 内容和上下文数据。',
          },
        },
      ]))
      .mockResolvedValueOnce(createResponsesStreamResponse([
        {
          event: 'response.output_text.delta',
          data: {
            type: 'response.output_text.delta',
            delta: '我继续基于压缩后的上下文给你结论。',
          },
        },
      ]));

    vi.stubGlobal('fetch', fetchMock);

    const execute = vi.fn().mockResolvedValue({
      tool: 'read_workspace_path_slice',
      arguments: {
        root: 'workspace',
        path: 'skills/zhangxuefeng-perspective/SKILL.md',
      },
      summary: '已读取超长 skill 内容',
      content: '文件内容：'.concat('就业、城市、分数线、行业趋势。'.repeat(500)),
      context: '就业、城市、分数线、行业趋势。'.repeat(500),
    });

    const compactionSignals: number[] = [];

    const harness = new OpenAIHarness(
      createConfig({
        MODEL_CONTEXT_WINDOW_TOKENS: 16_000,
        MODEL_AUTO_COMPACT_TOKEN_LIMIT: 120,
      }),
      {
        execute,
      } as never,
      {} as never,
    );

    const result = await harness.run({
      userId: 'u1',
      sessionId: 's1',
      message: '帮我分析人工智能专业值不值得报',
      history: [],
      files: [],
      availableSkills: [zhangXuefengSkill],
      callbacks: {
        onContextCompactionStart: ({ estimatedTokens }) => {
          compactionSignals.push(estimatedTokens);
        },
      },
    });

    expect(result.finalText).toBe('我先看下关键数据，我继续基于压缩后的上下文给你结论。');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(compactionSignals.length).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const compactRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(String(compactRequest.instructions)).toContain('上下文压缩器');
    expect(compactRequest.input).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'user',
        content: '帮我分析人工智能专业值不值得报',
      }),
      expect.objectContaining({
        role: 'assistant',
        content: '我先看下关键数据，',
      }),
      expect.objectContaining({
        role: 'assistant',
        content: expect.stringContaining('本轮工具结果'),
      }),
    ]));

    const postCompactRequest = JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body));
    expect(postCompactRequest.input).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'user',
        content: '帮我分析人工智能专业值不值得报',
      }),
      expect.objectContaining({
        role: 'assistant',
        content: expect.stringContaining('会话压缩摘要'),
      }),
    ]));
    expect(postCompactRequest.input.some((item: { role?: string; content?: string }) => item.role === 'assistant' && item.content === '我先看下关键数据，')).toBe(false);
    expect(postCompactRequest.input.some((item: { type?: string }) => item.type === 'function_call_output')).toBe(false);
  });

  it('allows the same turn to continue beyond eight model requests when follow-up inputs keep arriving', async () => {
    const fetchMock = vi.fn();
    for (let index = 0; index < 10; index += 1) {
      fetchMock.mockResolvedValueOnce(createResponsesStreamResponse([
        {
          event: 'response.output_text.delta',
          data: {
            type: 'response.output_text.delta',
            delta: `第${index + 1}轮。`,
          },
        },
      ]));
    }

    vi.stubGlobal('fetch', fetchMock);

    const harness = new OpenAIHarness(
      createConfig(),
      {
        execute: vi.fn(),
      } as never,
      {} as never,
    );

    let drained = 0;
    const result = await harness.run({
      userId: 'u1',
      sessionId: 's1',
      message: '开始处理',
      history: [],
      files: [],
      drainPendingInputs: async () => {
        if (drained >= 9) {
          return [];
        }
        drained += 1;
        return [{
          inputId: `queued_${drained}`,
          content: `继续第${drained}次`,
          createdAt: `2026-04-14T00:00:${String(drained).padStart(2, '0')}.000Z`,
        }];
      },
    });

    expect(result.finalText).toBe('第1轮。第2轮。第3轮。第4轮。第5轮。第6轮。第7轮。第8轮。第9轮。第10轮。');
    expect(result.roundsUsed).toBe(10);
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it('runs workspace scripts through the same harness loop', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createResponsesStreamResponse([
        {
          event: 'response.output_item.done',
          data: {
            type: 'response.output_item.done',
            item: {
              id: 'fc_1',
              type: 'function_call',
              call_id: 'call_run_script',
              name: 'run_workspace_script',
              arguments: JSON.stringify({
                path: 'skills/pdf/scripts/fill_fillable_fields.py',
                args: [
                  'uploads/form.pdf',
                  'uploads/field-values.json',
                  'outputs/weekly-report.pdf',
                ],
              }),
            },
          },
        },
      ]))
      .mockResolvedValueOnce(createResponsesStreamResponse([
        {
          event: 'response.output_text.delta',
          data: {
            type: 'response.output_text.delta',
            delta: 'PDF 已生成，你可以直接下载。',
          },
        },
      ]));

    vi.stubGlobal('fetch', fetchMock);

    const runnerExecute = vi.fn(async ({ onQueued, onProgress, onArtifact }: {
      onQueued?: () => Promise<void> | void;
      onProgress: (message: string, percent?: number, status?: string) => Promise<void> | void;
      onArtifact: (file: { id: string; displayName: string; relativePath: string; size: number; downloadUrl: string; userId: string; sessionId: string | null; mimeType: string | null; bucket: 'outputs'; source: 'generated'; createdAt: string }) => Promise<void> | void;
    }) => {
      await onQueued?.();
      await onProgress('正在生成 PDF', 60, 'running');
      await onArtifact({
        id: 'file_pdf',
        userId: 'u1',
        sessionId: 's1',
        displayName: '周报.pdf',
        relativePath: 'sessions/s1/outputs/周报.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        bucket: 'outputs',
        source: 'generated',
        createdAt: new Date().toISOString(),
        downloadUrl: '/api/files/file_pdf/download',
      });
      await onProgress('PDF 生成完成', 100, 'completed');
    });

    const progressMessages: string[] = [];
    const artifacts: string[] = [];

    const harness = new OpenAIHarness(
      createConfig(),
      {
        execute: vi.fn(),
      } as never,
      {
        execute: runnerExecute,
      } as never,
    );

    const result = await harness.run({
      userId: 'u1',
      sessionId: 's1',
      message: '帮我生成一份周报 PDF',
      history: [],
      files: [],
      availableSkills: [pdfSkill],
      callbacks: {
        onToolProgress: ({ message }) => {
          progressMessages.push(message);
        },
        onArtifact: (file) => {
          artifacts.push(file.displayName);
        },
      },
    });

    expect(result.finalText).toContain('PDF 已生成');
    expect(runnerExecute).toHaveBeenCalledTimes(1);
    expect(runnerExecute).toHaveBeenCalledWith(expect.objectContaining({
      scriptPath: 'skills/pdf/scripts/fill_fillable_fields.py',
      argv: ['uploads/form.pdf', 'uploads/field-values.json', 'outputs/weekly-report.pdf'],
      cwdRoot: 'session',
      cwdPath: '',
    }));
    expect(progressMessages).toContain('任务已排队');
    expect(progressMessages).toContain('正在生成 PDF');
    expect(progressMessages).toContain('PDF 生成完成');
    expect(artifacts).toEqual(['周报.pdf']);
  });

  it('feeds script execution failures back into the next reasoning round', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createResponsesStreamResponse([
        {
          event: 'response.output_item.done',
          data: {
            type: 'response.output_item.done',
            item: {
              id: 'fc_bad_pdf',
              type: 'function_call',
              call_id: 'call_run_script_bad',
              name: 'run_workspace_script',
              arguments: JSON.stringify({
                path: 'skills/pdf/scripts/fill_fillable_fields.py',
                args: ['uploads/form.pdf'],
              }),
            },
          },
        },
      ]))
      .mockResolvedValueOnce(createResponsesStreamResponse([
        {
          event: 'response.output_item.done',
          data: {
            type: 'response.output_item.done',
            item: {
              id: 'fc_good_pdf',
              type: 'function_call',
              call_id: 'call_run_script_good',
              name: 'run_workspace_script',
              arguments: JSON.stringify({
                path: 'skills/pdf/scripts/fill_fillable_fields.py',
                args: [
                  'uploads/form.pdf',
                  'uploads/field-values.json',
                  'outputs/strategy.pdf',
                ],
              }),
            },
          },
        },
      ]))
      .mockResolvedValueOnce(createResponsesStreamResponse([
        {
          event: 'response.output_text.delta',
          data: {
            type: 'response.output_text.delta',
            delta: 'PDF 已按最终内容生成。',
          },
        },
      ]));

    vi.stubGlobal('fetch', fetchMock);

    const runnerExecute = vi.fn()
      .mockRejectedValueOnce(new Error('Usage: fill_fillable_fields.py [input pdf] [field_values.json] [output pdf]'))
      .mockResolvedValueOnce(undefined);

    const harness = new OpenAIHarness(
      createConfig(),
      {
        execute: vi.fn(),
      } as never,
      {
        execute: runnerExecute,
      } as never,
    );

    const result = await harness.run({
      userId: 'u1',
      sessionId: 's1',
      message: '列院校策略，帮我生成 pdf',
      history: [],
      files: [],
      availableSkills: [pdfSkill],
    });

    expect(result.finalText).toContain('最终内容生成');
    expect(runnerExecute).toHaveBeenCalledTimes(2);

    const secondRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(secondRequest.input).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'function_call_output',
        call_id: 'call_run_script_bad',
      }),
    ]));
    const failedOutput = secondRequest.input.find((item: { type?: string; call_id?: string; output?: string }) => item.type === 'function_call_output' && item.call_id === 'call_run_script_bad');
    expect(String(failedOutput?.output ?? '')).toContain('fill_fillable_fields.py');
  });
});
