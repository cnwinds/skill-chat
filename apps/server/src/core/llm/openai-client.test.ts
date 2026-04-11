import { afterEach, describe, expect, it, vi } from 'vitest';
import { OpenAIModelClient } from './openai-client.js';

const createConfig = () => ({
  NODE_ENV: 'test' as const,
  PORT: 3000,
  WEB_ORIGIN: 'http://localhost:5173',
  DATA_ROOT: '/tmp/skillchat-test-data',
  SKILLS_ROOT: '/tmp/skillchat-test-skills',
  JWT_SECRET: 'test-secret',
  JWT_EXPIRES_IN: '7d',
  DEFAULT_SESSION_ACTIVE_SKILLS: [],
  OPENAI_BASE_URL: 'http://example.com/v1',
  OPENAI_API_KEY: 'test-token',
  OPENAI_MODEL_ROUTER: 'gpt-4o-mini',
  OPENAI_MODEL_PLANNER: 'gpt-4o-mini',
  OPENAI_MODEL_REPLY: 'gpt-5.4',
  OPENAI_REASONING_EFFORT_REPLY: 'xhigh' as const,
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
  CWD: '/tmp/skillchat-test',
  DB_PATH: '/tmp/skillchat-test/skillchat.sqlite',
  INLINE_JOBS: true,
});

const createStreamResponse = (chunks: string[]) => new Response(
  new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
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

describe('OpenAIModelClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses local heuristic routing without calling the remote router', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const client = new OpenAIModelClient(createConfig());

    const decision = await client.classify({
      message: '帮我选一个好一点的专业吧',
      history: [],
      files: [],
      skills: [],
    });

    expect(decision.mode).toBe('chat');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reads streamed text from the OpenAI Responses API with xhigh reasoning', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      createResponsesStreamResponse([
        {
          event: 'response.created',
          data: {
            type: 'response.created',
          },
        },
        {
          event: 'response.output_text.delta',
          data: {
            type: 'response.output_text.delta',
            delta: '你好',
          },
        },
        {
          event: 'response.output_text.delta',
          data: {
            type: 'response.output_text.delta',
            delta: '，我是 SkillChat',
          },
        },
      ]),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const client = new OpenAIModelClient(createConfig());
    const chunks: string[] = [];

    for await (const chunk of client.replyStream({
      message: '你好',
      history: [],
    })) {
      chunks.push(chunk);
    }

    expect(chunks.join('')).toContain('你好，我是 SkillChat');
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://example.com/v1/responses',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    const request = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(payload.model).toBe('gpt-5.4');
    expect(payload.max_output_tokens).toBe(8192);
    expect(payload.reasoning).toEqual({
      effort: 'xhigh',
    });
  });

  it('throws a provider error when the provider streams no text', async () => {
    const fetchSpy = vi.fn().mockImplementation(() => Promise.resolve(
      createResponsesStreamResponse([
        {
          event: 'response.created',
          data: {
            type: 'response.created',
          },
        },
      ]),
    ));
    vi.stubGlobal('fetch', fetchSpy);

    const client = new OpenAIModelClient(createConfig());
    await expect((async () => {
      for await (const _chunk of client.replyStream({
        message: '帮我选一个好一点的专业吧',
        history: [],
      })) {
        // drain the stream
      }
    })()).rejects.toThrow('OpenAI 回复失败：OpenAI Responses stream returned empty text');
    expect(fetchSpy).toHaveBeenCalledTimes(5);
  });

  it('retries responses api errors up to 5 attempts before succeeding', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(new Response('upstream failed', { status: 502 }))
      .mockResolvedValueOnce(new Response('upstream failed', { status: 502 }))
      .mockResolvedValueOnce(new Response('upstream failed', { status: 502 }))
      .mockResolvedValueOnce(new Response('upstream failed', { status: 502 }))
      .mockResolvedValueOnce(
        createResponsesStreamResponse([
          {
            event: 'response.output_text.delta',
            data: {
              type: 'response.output_text.delta',
              delta: '第5次成功',
            },
          },
        ]),
      );
    vi.stubGlobal('fetch', fetchSpy);

    const client = new OpenAIModelClient(createConfig());
    const chunks: string[] = [];

    for await (const chunk of client.replyStream({
      message: '你好',
      history: [],
    })) {
      chunks.push(chunk);
    }

    expect(chunks.join('')).toBe('第5次成功');
    expect(fetchSpy).toHaveBeenCalledTimes(5);
  });

  it('includes skill protocol and recent history in tool planning requests', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(
      createStreamResponse([
        'data: {"choices":[{"delta":{"content":"{\\"toolCalls\\":[]}"}}]}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    vi.stubGlobal('fetch', fetchSpy);

    const client = new OpenAIModelClient(createConfig());
    await client.planToolUse({
      message: '帮我分析人工智能专业就业前景',
      history: [
        {
          id: 'evt_1',
          sessionId: 's1',
          kind: 'message',
          role: 'user',
          type: 'text',
          content: '用张雪峰的视角回答',
          createdAt: '2026-04-10T00:00:00.000Z',
        },
        {
          id: 'evt_2',
          sessionId: 's1',
          kind: 'message',
          role: 'assistant',
          type: 'text',
          content: '你先告诉我多少分、哪个省。',
          createdAt: '2026-04-10T00:00:01.000Z',
        },
      ],
      files: [],
      tools: [
        {
          name: 'web_search',
          description: '搜索公开网页的最新信息',
          inputSchema: {},
        },
      ],
      skill: {
        name: 'zhangxuefeng-perspective',
        description: '张雪峰式教育决策分析',
        entrypoint: '',
        runtime: 'chat',
        timeoutSec: 120,
        references: ['jobs.md'],
        directory: '/tmp/skills/zhangxuefeng-perspective',
        markdown: [
          '# 张雪峰 · 思维操作系统',
          '## 回答工作流（Agentic Protocol）',
          '### Step 2: 张雪峰式研究',
          '**必须使用工具（WebSearch等）获取真实信息，不可跳过。**',
        ].join('\n\n'),
        referencesContent: [
          {
            name: 'jobs.md',
            content: '人工智能专业就业率、薪资中位数、行业去向等最新参考数据。',
          },
        ],
      },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const request = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    const toolContext = JSON.parse(payload.messages[1].content);

    expect(toolContext.today).toMatch(/^20\d{2}-\d{2}-\d{2}$/);
    expect(toolContext.currentYear).toBe(new Date().getFullYear());
    expect(payload.max_tokens).toBe(8192);
    expect(payload.messages[0].content).toContain(`当前年份是 ${new Date().getFullYear()}`);
    expect(payload.messages[0].content).toContain('如果当前 skill 的 protocol 明确要求“先研究/先搜再答”');
    expect(toolContext.history).toEqual([
      {
        role: 'user',
        content: '用张雪峰的视角回答',
      },
      {
        role: 'assistant',
        content: '你先告诉我多少分、哪个省。',
      },
    ]);
    expect(toolContext.skill.protocol).toContain('必须使用工具');
    expect(toolContext.skill.references[0]).toEqual(expect.objectContaining({
      name: 'jobs.md',
    }));
    expect(toolContext.skill.references[0].excerpt).toContain('就业率');
  });
});
