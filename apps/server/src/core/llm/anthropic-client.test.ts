import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnthropicModelClient } from './anthropic-client.js';

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
  OPENAI_API_KEY: '',
  OPENAI_MODEL_ROUTER: 'gpt-4o-mini',
  OPENAI_MODEL_PLANNER: 'gpt-4o-mini',
  OPENAI_MODEL_REPLY: 'gpt-4o-mini',
  OPENAI_REASONING_EFFORT_REPLY: 'xhigh' as const,
  LLM_MAX_OUTPUT_TOKENS: 8192,
  TOOL_MAX_OUTPUT_TOKENS: 3072,
  ANTHROPIC_BASE_URL: 'http://example.com',
  ANTHROPIC_AUTH_TOKEN: 'test-token',
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

describe('AnthropicModelClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses local heuristic routing without calling the remote router', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const client = new AnthropicModelClient(createConfig());

    const decision = await client.classify({
      message: '帮我选一个好一点的专业吧',
      history: [],
      files: [],
      skills: [],
    });

    expect(decision.mode).toBe('chat');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('throws a provider error when the provider returns empty text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            content: [{ type: 'text' }],
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
            },
          },
        ),
      ),
    );

    const client = new AnthropicModelClient(createConfig());
    await expect((async () => {
      for await (const _chunk of client.replyStream({
        message: '帮我选一个好一点的专业吧',
        history: [],
      })) {
        // drain the stream
      }
    })()).rejects.toThrow('Anthropic 回复失败：Anthropic reply returned empty text');
  });

  it('retries anthropic api errors up to 5 attempts before succeeding', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(new Response('bad gateway', { status: 502 }))
      .mockResolvedValueOnce(new Response('bad gateway', { status: 502 }))
      .mockResolvedValueOnce(new Response('bad gateway', { status: 502 }))
      .mockResolvedValueOnce(new Response('bad gateway', { status: 502 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content: [{ type: 'text', text: '第5次成功' }],
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
            },
          },
        ),
      );
    vi.stubGlobal('fetch', fetchSpy);

    const client = new AnthropicModelClient(createConfig());
    const chunks: string[] = [];

    for await (const chunk of client.replyStream({
      message: '你好',
      history: [],
    })) {
      chunks.push(chunk);
    }

    expect(chunks.join('')).toBe('第5次成功');
    expect(fetchSpy).toHaveBeenCalledTimes(5);
    const request = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(request.body));
    expect(payload.max_tokens).toBe(8192);
  });
});
