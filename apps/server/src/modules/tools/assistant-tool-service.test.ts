import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../config/env.js';
import { AssistantToolService, networkResolver } from './assistant-tool-service.js';

const createConfig = (dataRoot: string): AppConfig => ({
  NODE_ENV: 'test',
  PORT: 3000,
  WEB_ORIGIN: 'http://localhost:5173',
  DATA_ROOT: dataRoot,
  SKILLS_ROOT: path.join(dataRoot, 'skills'),
  DB_PATH: path.join(dataRoot, 'skillchat.sqlite'),
  CWD: dataRoot,
  INLINE_JOBS: true,
  JWT_SECRET: 'test-secret',
  JWT_EXPIRES_IN: '7d',
  DEFAULT_SESSION_ACTIVE_SKILLS: [],
  OPENAI_BASE_URL: 'http://example.com/v1',
  OPENAI_API_KEY: 'test-token',
  OPENAI_MODEL_ROUTER: 'gpt-4o-mini',
  OPENAI_MODEL_PLANNER: 'gpt-4o-mini',
  OPENAI_MODEL_REPLY: 'gpt-5.4',
  OPENAI_REASONING_EFFORT_REPLY: 'xhigh',
  LLM_MAX_OUTPUT_TOKENS: 8192,
  TOOL_MAX_OUTPUT_TOKENS: 3072,
  ANTHROPIC_BASE_URL: 'http://example.com',
  ANTHROPIC_AUTH_TOKEN: '',
  ANTHROPIC_API_KEY: '',
  ANTHROPIC_MODEL_ROUTER: 'claude-sonnet-4-5',
  ANTHROPIC_MODEL_PLANNER: 'claude-sonnet-4-5',
  ANTHROPIC_MODEL_REPLY: 'claude-sonnet-4-5',
  ENABLE_ASSISTANT_TOOLS: true,
  LLM_REQUEST_TIMEOUT_MS: 1000,
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

describe('AssistantToolService', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('lists and reads session text files', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'skillchat-tools-'));
    const userId = 'u1';
    const sessionId = 's1';
    const relativePath = 'sessions/s1/uploads/notes.txt';
    const absolutePath = path.join(tempRoot, 'users', userId, relativePath);

    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, '第一行\n第二行\n第三行', 'utf8');

    const fileContext = [{
      id: 'file_1',
      name: 'notes.txt',
      mimeType: 'text/plain',
      size: 18,
      bucket: 'uploads' as const,
      relativePath,
    }];

    const service = new AssistantToolService(
      createConfig(tempRoot),
      {
        getFileContext: () => fileContext,
        recordGeneratedFile: vi.fn(),
      } as never,
      {
        get: vi.fn(),
      } as never,
    );

    const listed = await service.execute({
      userId,
      sessionId,
      call: {
        tool: 'list_files',
        arguments: {},
      },
    });
    expect(listed.content).toContain('notes.txt');

    const read = await service.execute({
      userId,
      sessionId,
      call: {
        tool: 'read_file',
        arguments: {
          fileId: 'file_1',
          startLine: 2,
          endLine: 2,
        },
      },
    });

    expect(read.summary).toContain('notes.txt');
    expect(read.content).toContain('行范围：2-2');
    expect(read.content).toContain('第二行');

    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('lists and reads workspace paths through internal tools', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'skillchat-workspace-'));
    await fs.mkdir(path.join(tempRoot, 'docs'), { recursive: true });
    await fs.writeFile(path.join(tempRoot, 'docs', 'guide.md'), '# Guide\n\nLine 2\nLine 3', 'utf8');

    const service = new AssistantToolService(
      createConfig(tempRoot),
      {
        getFileContext: () => [],
        recordGeneratedFile: vi.fn(),
      } as never,
      {
        get: vi.fn(),
      } as never,
    );

    const listed = await service.execute({
      userId: 'u1',
      sessionId: 's1',
      call: {
        tool: 'list_workspace_paths',
        arguments: {
          root: 'workspace',
          path: 'docs',
          depth: 1,
        },
      },
    });

    expect(listed.summary).toContain('命中');
    expect(listed.content).toContain('guide.md');

    const read = await service.execute({
      userId: 'u1',
      sessionId: 's1',
      call: {
        tool: 'read_workspace_path_slice',
        arguments: {
          root: 'workspace',
          path: 'docs/guide.md',
          startLine: 1,
          endLine: 3,
        },
      },
    });

    expect(read.summary).toContain('docs/guide.md');
    expect(read.content).toContain('# Guide');
    expect(read.content).toContain('Line 2');

    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('blocks hidden workspace paths by default', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'skillchat-hidden-workspace-'));
    await fs.writeFile(path.join(tempRoot, '.env'), 'SECRET=1', 'utf8');

    const service = new AssistantToolService(
      createConfig(tempRoot),
      {
        getFileContext: () => [],
        recordGeneratedFile: vi.fn(),
      } as never,
      {
        get: vi.fn(),
      } as never,
    );

    await expect(service.execute({
      userId: 'u1',
      sessionId: 's1',
      call: {
        tool: 'read_workspace_path_slice',
        arguments: {
          root: 'workspace',
          path: '.env',
        },
      },
    })).rejects.toThrow('不允许访问隐藏路径或点文件');

    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('lists and reads skill resources', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'skillchat-skill-tools-'));
    const skill = {
      name: 'zhangxuefeng-perspective',
      description: 'desc',
      entrypoint: '',
      runtime: 'chat' as const,
      timeoutSec: 120,
      references: ['majors.md'],
      directory: path.join(tempRoot, 'skills', 'zhangxuefeng-perspective'),
      markdown: '# Skill Rule\n\nUse tough love.',
      referencesContent: [
        {
          name: 'majors.md',
          content: '金融、计算机、口腔医学',
        },
      ],
    };

    const service = new AssistantToolService(
      createConfig(tempRoot),
      {
        getFileContext: () => [],
        recordGeneratedFile: vi.fn(),
      } as never,
      {
        get: vi.fn().mockReturnValue(skill),
      } as never,
    );

    const listed = await service.execute({
      userId: 'u1',
      sessionId: 's1',
      skill,
      call: {
        tool: 'list_skill_resources',
        arguments: {},
      },
    });

    expect(listed.content).toContain('SKILL.md');
    expect(listed.content).toContain('references/majors.md');

    const read = await service.execute({
      userId: 'u1',
      sessionId: 's1',
      skill,
      call: {
        tool: 'read_skill_resource_slice',
        arguments: {
          resource: 'majors.md',
        },
      },
    });

    expect(read.summary).toContain('majors.md');
    expect(read.content).toContain('口腔医学');

    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('writes text artifacts into session outputs', async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'skillchat-artifacts-'));
    const userId = 'u1';
    const sessionId = 's1';
    const outputsRoot = path.join(tempRoot, 'users', userId, 'sessions', sessionId, 'outputs');
    await fs.mkdir(outputsRoot, { recursive: true });

    const recordGeneratedFile = vi.fn(async ({ absolutePath, displayName }: { absolutePath: string; displayName?: string }) => ({
      id: 'file_generated',
      userId,
      sessionId,
      displayName: displayName ?? path.basename(absolutePath),
      relativePath: path.relative(path.join(tempRoot, 'users', userId), absolutePath).replace(/\\/g, '/'),
      mimeType: 'text/markdown',
      size: (await fs.stat(absolutePath)).size,
      bucket: 'outputs' as const,
      source: 'generated' as const,
      createdAt: new Date().toISOString(),
      downloadUrl: '/api/files/file_generated/download',
    }));

    const service = new AssistantToolService(
      createConfig(tempRoot),
      {
        getFileContext: () => [],
        recordGeneratedFile,
      } as never,
      {
        get: vi.fn(),
      } as never,
    );

    const result = await service.execute({
      userId,
      sessionId,
      call: {
        tool: 'write_artifact_file',
        arguments: {
          fileName: 'report.md',
          content: '# Report\n\nHello',
        },
      },
    });

    expect(result.summary).toContain('report.md');
    expect(recordGeneratedFile).toHaveBeenCalledTimes(1);
    const writtenPath = path.join(outputsRoot, 'report.md');
    expect(await fs.readFile(writtenPath, 'utf8')).toContain('Hello');

    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('parses native OpenAI web_search actions and final answer output', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createResponsesStreamResponse([
        {
          event: 'response.output_item.done',
          data: {
            type: 'response.output_item.done',
            item: {
              id: 'ws_1',
              type: 'web_search_call',
              status: 'completed',
              action: {
                type: 'search',
                query: 'site:openai.com GPT-5.4 release date OpenAI',
                queries: [
                  'site:openai.com GPT-5.4 release date OpenAI',
                  'site:openai.com "gpt-5.4" OpenAI',
                ],
              },
            },
          },
        },
        {
          event: 'response.output_text.delta',
          data: {
            type: 'response.output_text.delta',
            delta: '我查到 GPT-5.4 发布于 2026 年 3 月 5 日。',
          },
        },
        {
          event: 'response.output_text.delta',
          data: {
            type: 'response.output_text.delta',
            delta: '\n来源：https://openai.com/index/introducing-gpt-5-4/',
          },
        },
      ]),
    );

    vi.stubGlobal('fetch', fetchMock);

    const service = new AssistantToolService(
      createConfig('/tmp/skillchat-tools'),
      {
        getFileContext: () => [],
        recordGeneratedFile: vi.fn(),
      } as never,
      {
        get: vi.fn(),
      } as never,
    );

    const result = await service.execute({
      userId: 'u1',
      sessionId: 's1',
      call: {
        tool: 'web_search',
        arguments: {
          query: '帮我查一下最新消息',
          maxResults: 3,
        },
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://example.com/v1/responses',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(payload.model).toBe('gpt-5.4');
    expect(payload.tool_choice).toBe('required');
    expect(payload.max_output_tokens).toBe(3072);
    expect(payload.tools).toEqual([
      {
        type: 'web_search',
      },
    ]);
    expect(result.summary).toContain('OpenAI 原生 web_search');
    expect(result.content).toContain('执行方式：OpenAI Responses API 原生 web_search');
    expect(result.content).toContain('Search');
    expect(result.content).toContain('site:openai.com GPT-5.4 release date OpenAI');
    expect(result.content).toContain('来源：https://openai.com/index/introducing-gpt-5-4/');
    expect(result.context).toContain('OpenAI 原生 web_search 动作');
  });

  it('keeps model-provided stale-year queries unchanged in native web_search suggestions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createResponsesStreamResponse([
        {
          event: 'response.output_text.delta',
          data: {
            type: 'response.output_text.delta',
            delta: 'done',
          },
        },
      ]),
    );

    vi.stubGlobal('fetch', fetchMock);
    const staleYear = new Date().getFullYear() - 2;

    const service = new AssistantToolService(
      createConfig('/tmp/skillchat-tools'),
      {
        getFileContext: () => [],
        recordGeneratedFile: vi.fn(),
      } as never,
      {
        get: vi.fn(),
      } as never,
    );

    await service.execute({
      userId: 'u1',
      sessionId: 's1',
      call: {
        tool: 'web_search',
        arguments: {
          query: `人工智能 专业 就业率 薪资 中位数 毕业去向 ${staleYear}`,
          maxResults: 3,
        },
      },
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(String(payload.instructions)).toContain(`人工智能 专业 就业率 薪资 中位数 毕业去向 ${staleYear}`);
    expect(String(payload.instructions)).not.toContain(`人工智能 专业 就业率 薪资 中位数 毕业去向 ${new Date().getFullYear()}`);
  });

  it('throws native web_search errors instead of falling back to local search', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError')),
    );

    const service = new AssistantToolService(
      createConfig('/tmp/skillchat-tools'),
      {
        getFileContext: () => [],
        recordGeneratedFile: vi.fn(),
      } as never,
      {
        get: vi.fn(),
      } as never,
    );

    await expect(service.execute({
      userId: 'u1',
      sessionId: 's1',
      call: {
        tool: 'web_search',
        arguments: {
          query: '帮我查一下最新消息',
          maxResults: 3,
        },
      },
    })).rejects.toThrow('原生联网搜索失败：The operation was aborted due to timeout');
  });

  it('retries native web_search api errors up to 5 attempts before succeeding', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('bad gateway', { status: 502 }))
      .mockResolvedValueOnce(new Response('bad gateway', { status: 502 }))
      .mockResolvedValueOnce(new Response('bad gateway', { status: 502 }))
      .mockResolvedValueOnce(new Response('bad gateway', { status: 502 }))
      .mockResolvedValueOnce(
        createResponsesStreamResponse([
          {
            event: 'response.output_item.done',
            data: {
              type: 'response.output_item.done',
              item: {
                id: 'ws_1',
                type: 'web_search_call',
                status: 'completed',
                action: {
                  type: 'search',
                  query: '人工智能 专业 就业率 2026',
                },
              },
            },
          },
          {
            event: 'response.output_text.delta',
            data: {
              type: 'response.output_text.delta',
              delta: '第5次搜索成功',
            },
          },
        ]),
      );

    vi.stubGlobal('fetch', fetchMock);

    const service = new AssistantToolService(
      createConfig('/tmp/skillchat-tools'),
      {
        getFileContext: () => [],
        recordGeneratedFile: vi.fn(),
      } as never,
      {
        get: vi.fn(),
      } as never,
    );

    const result = await service.execute({
      userId: 'u1',
      sessionId: 's1',
      call: {
        tool: 'web_search',
        arguments: {
          query: '人工智能专业就业前景怎么样',
          maxResults: 3,
        },
      },
    });

    expect(result.content).toContain('第5次搜索成功');
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('returns a readable timeout reason when web fetch times out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('fetch failed', {
        cause: {
          code: 'UND_ERR_CONNECT_TIMEOUT',
        },
      })),
    );

    const service = new AssistantToolService(
      createConfig('/tmp/skillchat-tools'),
      {
        getFileContext: () => [],
        recordGeneratedFile: vi.fn(),
      } as never,
      {
        get: vi.fn(),
      } as never,
    );

    await expect(service.execute({
      userId: 'u1',
      sessionId: 's1',
      call: {
        tool: 'web_fetch',
        arguments: {
          url: 'https://example.com/page',
        },
      },
    })).rejects.toThrow('访问网页超时');
  });

  it('retries web fetch with ipv4-first when dual-stack connect timeout occurs', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed', {
        cause: {
          code: 'UND_ERR_CONNECT_TIMEOUT',
        },
      }))
      .mockResolvedValueOnce(new Response('<html><title>上海政法学院</title><body>分数线信息</body></html>', {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
        },
      }));

    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(networkResolver, 'lookup').mockResolvedValue([
      { address: '2001:db8::1', family: 6 },
      { address: '203.0.113.8', family: 4 },
    ] as unknown as Awaited<ReturnType<typeof networkResolver.lookup>>);
    const getDefaultResultOrderSpy = vi.spyOn(networkResolver, 'getDefaultResultOrder').mockReturnValue('verbatim');
    const setDefaultResultOrderSpy = vi.spyOn(networkResolver, 'setDefaultResultOrder').mockImplementation(() => {});

    const service = new AssistantToolService(
      createConfig('/tmp/skillchat-tools'),
      {
        getFileContext: () => [],
        recordGeneratedFile: vi.fn(),
      } as never,
      {
        get: vi.fn(),
      } as never,
    );

    const result = await service.execute({
      userId: 'u1',
      sessionId: 's1',
      call: {
        tool: 'web_fetch',
        arguments: {
          url: 'https://xxgk.shupl.edu.cn/2024/0918/c4032a133663/page.htm',
        },
      },
    });

    expect(result.summary).toContain('xxgk.shupl.edu.cn');
    expect(result.content).toContain('上海政法学院');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getDefaultResultOrderSpy).toHaveBeenCalledTimes(1);
    expect(setDefaultResultOrderSpy).toHaveBeenNthCalledWith(1, 'ipv4first');
    expect(setDefaultResultOrderSpy).toHaveBeenNthCalledWith(2, 'verbatim');
  });

  it('does not retry web fetch with ipv4-first when the host is not dual-stack', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed', {
      cause: {
        code: 'UND_ERR_CONNECT_TIMEOUT',
      },
    }));

    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(networkResolver, 'lookup').mockResolvedValue([
      { address: '2001:db8::1', family: 6 },
    ] as unknown as Awaited<ReturnType<typeof networkResolver.lookup>>);
    const setDefaultResultOrderSpy = vi.spyOn(networkResolver, 'setDefaultResultOrder').mockImplementation(() => {});

    const service = new AssistantToolService(
      createConfig('/tmp/skillchat-tools'),
      {
        getFileContext: () => [],
        recordGeneratedFile: vi.fn(),
      } as never,
      {
        get: vi.fn(),
      } as never,
    );

    await expect(service.execute({
      userId: 'u1',
      sessionId: 's1',
      call: {
        tool: 'web_fetch',
        arguments: {
          url: 'https://example.com/page',
        },
      },
    })).rejects.toThrow('访问网页超时');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(setDefaultResultOrderSpy).not.toHaveBeenCalled();
  });
});
