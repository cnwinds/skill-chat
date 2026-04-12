import { describe, expect, it, vi, afterEach } from 'vitest';
import type { AppConfig } from '../../config/env.js';
import { OpenAIHarness } from './openai-harness.js';

const createConfig = (): AppConfig => ({
  NODE_ENV: 'test',
  PORT: 3000,
  WEB_ORIGIN: 'http://localhost:5173',
  DATA_ROOT: '/tmp/skillchat-data',
  SKILLS_ROOT: '/tmp/skillchat-data/skills',
  DB_PATH: '/tmp/skillchat-data/skillchat.sqlite',
  CWD: '/workspace/qizhi',
  INLINE_JOBS: true,
  JWT_SECRET: 'test-secret',
  JWT_EXPIRES_IN: '7d',
  OPENAI_BASE_URL: 'http://example.com/v1',
  OPENAI_API_KEY: 'test-token',
  OPENAI_MODEL_ROUTER: 'gpt-4o-mini',
  OPENAI_MODEL_PLANNER: 'gpt-4o-mini',
  OPENAI_MODEL_REPLY: 'gpt-5.4',
  OPENAI_REASONING_EFFORT_REPLY: 'xhigh',
  LLM_MAX_OUTPUT_TOKENS: 4096,
  TOOL_MAX_OUTPUT_TOKENS: 3072,
      ANTHROPIC_BASE_URL: 'http://example.com',
      ANTHROPIC_AUTH_TOKEN: '',
      ANTHROPIC_API_KEY: '',
      ANTHROPIC_MODEL_ROUTER: 'claude-sonnet-4-5',
      ANTHROPIC_MODEL_PLANNER: 'claude-sonnet-4-5',
      ANTHROPIC_MODEL_REPLY: 'claude-sonnet-4-5',
      DEFAULT_SESSION_ACTIVE_SKILLS: [],
      ENABLE_ASSISTANT_TOOLS: true,
      LLM_REQUEST_TIMEOUT_MS: 1_000,
      MAX_CONCURRENT_RUNS: 5,
  RUN_TIMEOUT_MS: 120_000,
  USER_STORAGE_QUOTA_MB: 1024,
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
  entrypoint: '',
  runtime: 'chat' as const,
  timeoutSec: 120,
  references: ['style-guide.md', 'core-framework.md', 'boundaries-and-sources.md'],
  directory: '/workspace/qizhi/skills/zhangxuefeng-perspective',
  markdown: '# 张雪峰 Perspective\n\n先读本文件，再按需读取 style-guide、core-framework、boundaries-and-sources。',
  referencesContent: [
    {
      name: 'style-guide.md',
      content: '直接用“我”回答，短句、高密度、东北大哥语气。',
    },
    {
      name: 'core-framework.md',
      content: '先看中位数，再看就业和城市。',
    },
    {
      name: 'boundaries-and-sources.md',
      content: '张雪峰已于2026年3月24日去世，回答时注意事实边界。',
    },
  ],
};

const pdfSkill = {
  name: 'pdf',
  description: '生成 PDF 文件。',
  entrypoint: 'scripts/run.py',
  runtime: 'python' as const,
  timeoutSec: 120,
  references: ['usage.md'],
  directory: '/workspace/qizhi/skills/pdf',
  markdown: '# PDF Skill\n\n生成 PDF。',
  referencesContent: [
    {
      name: 'usage.md',
      content: '生成报告 PDF',
    },
  ],
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
      {
        listRegistered: vi.fn().mockReturnValue([zhangXuefengSkill, pdfSkill]),
        get: vi.fn(),
      } as never,
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
      activatedSkills: [zhangXuefengSkill],
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
    expect(String(firstRequest.instructions)).toContain('## Explicitly Activated Skills');
    expect(String(firstRequest.instructions)).toContain('- zhangxuefeng-perspective (file: skills/zhangxuefeng-perspective/SKILL.md)');
    expect(String(firstRequest.instructions)).not.toContain('# 张雪峰风格');

    const secondRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(secondRequest.input).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'function_call_output',
        call_id: 'call_read_skill',
      }),
    ]));
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
      {
        listRegistered: vi.fn().mockReturnValue([zhangXuefengSkill]),
        get: vi.fn(),
      } as never,
    );

    const result = await harness.run({
      userId: 'u1',
      sessionId: 's1',
      message: '帮我看下人工智能专业的最新就业情况',
      history: [],
      files: [],
      activatedSkills: [zhangXuefengSkill],
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
      {
        listRegistered: vi.fn().mockReturnValue([zhangXuefengSkill]),
        get: vi.fn(),
      } as never,
    );

    const result = await harness.run({
      userId: 'u1',
      sessionId: 's1',
      message: '帮我看下就业情况',
      history: [],
      files: [],
      activatedSkills: [zhangXuefengSkill],
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
      {
        listRegistered: vi.fn().mockReturnValue([zhangXuefengSkill]),
        get: vi.fn(),
      } as never,
    );

    const result = await harness.run({
      userId: 'u1',
      sessionId: 's1',
      message: '扮演张雪峰，帮我分析人工智能专业值不值得报',
      history: [],
      files: [],
      activatedSkills: [zhangXuefengSkill],
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
      {
        listRegistered: vi.fn().mockReturnValue([zhangXuefengSkill]),
        get: vi.fn(),
      } as never,
    );

    const result = await harness.run({
      userId: 'u1',
      sessionId: 's1',
      message: '扮演张雪峰，结合时间线背景回答',
      history: [],
      files: [],
      activatedSkills: [zhangXuefengSkill],
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

  it('runs executable skills through the same harness loop', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createResponsesStreamResponse([
        {
          event: 'response.output_item.done',
          data: {
            type: 'response.output_item.done',
            item: {
              id: 'fc_1',
              type: 'function_call',
              call_id: 'call_run_skill',
              name: 'run_skill',
              arguments: JSON.stringify({
                skillName: 'pdf',
                prompt: '渲染最终文档为 PDF',
                arguments: {
                  title: '周报',
                  documentMarkdown: '## 本周概览\n\n- 销售额增长 12%\n- 新增客户 5 家',
                },
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
      {
        listRegistered: vi.fn().mockReturnValue([zhangXuefengSkill, pdfSkill]),
        get: vi.fn().mockImplementation((name: string) => {
          if (name === 'pdf') {
            return pdfSkill;
          }
          return zhangXuefengSkill;
        }),
      } as never,
    );

    const result = await harness.run({
      userId: 'u1',
      sessionId: 's1',
      message: '帮我生成一份周报 PDF',
      history: [],
      files: [],
      activatedSkills: [pdfSkill],
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
    expect(progressMessages).toContain('任务已排队');
    expect(progressMessages).toContain('正在生成 PDF');
    expect(progressMessages).toContain('PDF 生成完成');
    expect(artifacts).toEqual(['周报.pdf']);
  });

  it('forces pdf skill retries when the model sends only a document brief', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(createResponsesStreamResponse([
        {
          event: 'response.output_item.done',
          data: {
            type: 'response.output_item.done',
            item: {
              id: 'fc_bad_pdf',
              type: 'function_call',
              call_id: 'call_run_skill_bad',
              name: 'run_skill',
              arguments: JSON.stringify({
                skillName: 'pdf',
                prompt: '请生成一份中文 PDF，文档要求：包含标题、摘要、院校策略、结论。',
                arguments: {
                  title: '院校策略',
                },
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
              call_id: 'call_run_skill_good',
              name: 'run_skill',
              arguments: JSON.stringify({
                skillName: 'pdf',
                prompt: '渲染最终文档为 PDF',
                arguments: {
                  title: '院校策略',
                  summary: '基于用户条件给出冲稳保建议。',
                  documentMarkdown: [
                    '## 一、结论先行',
                    '',
                    '法学优先，师范作为保底备选。',
                    '',
                    '## 二、院校策略',
                    '',
                    '- 冲：华东政法、中国政法',
                    '- 稳：上海政法、长三角法学平台',
                    '- 保：法学相关专业组与师范方向双保险',
                  ].join('\n'),
                },
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

    const runnerExecute = vi.fn(async ({ onQueued, onProgress, onArtifact, prompt, toolArguments }: {
      onQueued?: () => Promise<void> | void;
      onProgress: (message: string, percent?: number, status?: string) => Promise<void> | void;
      onArtifact: (file: { id: string; displayName: string; relativePath: string; size: number; downloadUrl: string; userId: string; sessionId: string | null; mimeType: string | null; bucket: 'outputs'; source: 'generated'; createdAt: string }) => Promise<void> | void;
      prompt: string;
      toolArguments: Record<string, unknown>;
    }) => {
      expect(prompt).toBe('渲染最终文档为 PDF');
      expect(toolArguments).toMatchObject({
        title: '院校策略',
      });
      expect(String(toolArguments.documentMarkdown ?? '')).toContain('## 二、院校策略');

      await onQueued?.();
      await onProgress('正在生成 PDF', 60, 'running');
      await onArtifact({
        id: 'file_pdf_retry',
        userId: 'u1',
        sessionId: 's1',
        displayName: '院校策略.pdf',
        relativePath: 'sessions/s1/outputs/院校策略.pdf',
        mimeType: 'application/pdf',
        size: 2048,
        bucket: 'outputs',
        source: 'generated',
        createdAt: new Date().toISOString(),
        downloadUrl: '/api/files/file_pdf_retry/download',
      });
      await onProgress('PDF 生成完成', 100, 'completed');
    });

    const harness = new OpenAIHarness(
      createConfig(),
      {
        execute: vi.fn(),
      } as never,
      {
        execute: runnerExecute,
      } as never,
      {
        listRegistered: vi.fn().mockReturnValue([pdfSkill]),
        get: vi.fn().mockReturnValue(pdfSkill),
      } as never,
    );

    const result = await harness.run({
      userId: 'u1',
      sessionId: 's1',
      message: '列院校策略，帮我生成 pdf',
      history: [],
      files: [],
      activatedSkills: [pdfSkill],
    });

    expect(result.finalText).toContain('最终内容生成');
    expect(runnerExecute).toHaveBeenCalledTimes(1);

    const secondRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(secondRequest.input).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'function_call_output',
        call_id: 'call_run_skill_bad',
      }),
    ]));
    const failedOutput = secondRequest.input.find((item: { type?: string; call_id?: string; output?: string }) => item.type === 'function_call_output' && item.call_id === 'call_run_skill_bad');
    expect(String(failedOutput?.output ?? '')).toContain('arguments.documentMarkdown');
  });
});
