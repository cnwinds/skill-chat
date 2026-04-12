import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../config/env.js';
import { DynamicModelClient } from './dynamic-model-client.js';

const createConfig = (): AppConfig => ({
  NODE_ENV: 'test',
  PORT: 3000,
  WEB_ORIGIN: 'http://localhost:5173',
  DATA_ROOT: '/tmp/skillchat-test-data',
  SKILLS_ROOT: '/tmp/skillchat-test-skills',
  JWT_SECRET: 'test-secret',
  JWT_EXPIRES_IN: '7d',
  DEFAULT_SESSION_ACTIVE_SKILLS: [],
  OPENAI_BASE_URL: 'http://openai.example.com/v1',
  OPENAI_API_KEY: '',
  OPENAI_MODEL_ROUTER: 'gpt-4o-mini',
  OPENAI_MODEL_PLANNER: 'gpt-4o-mini',
  OPENAI_MODEL_REPLY: 'gpt-5.4',
  OPENAI_REASONING_EFFORT_REPLY: 'xhigh',
  LLM_MAX_OUTPUT_TOKENS: 8192,
  TOOL_MAX_OUTPUT_TOKENS: 3072,
  ANTHROPIC_BASE_URL: 'http://anthropic.example.com',
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

const collectChunks = async (stream: AsyncIterable<string>) => {
  const chunks: string[] = [];

  for await (const chunk of stream) {
    chunks.push(chunk);
  }

  return chunks.join('');
};

describe('DynamicModelClient', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('switches providers on the next request after runtime config changes', async () => {
    const config = createConfig();
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url === 'http://anthropic.example.com/v1/messages') {
        return new Response(
          JSON.stringify({
            content: [{ type: 'text', text: 'anthropic reply' }],
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json',
            },
          },
        );
      }

      if (url === 'http://openai.example.com/v1/responses') {
        return createResponsesStreamResponse([
          {
            event: 'response.output_text.delta',
            data: {
              type: 'response.output_text.delta',
              delta: 'openai reply',
            },
          },
        ]);
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    vi.stubGlobal('fetch', fetchSpy);

    const client = new DynamicModelClient(config);

    const ruleBasedReply = await collectChunks(client.replyStream({
      message: '你好',
      history: [],
    }));
    expect(ruleBasedReply).toContain('你好');
    expect(fetchSpy).not.toHaveBeenCalled();

    config.ANTHROPIC_API_KEY = 'anthropic-token';
    config.ANTHROPIC_AUTH_TOKEN = 'anthropic-token';

    const anthropicReply = await collectChunks(client.replyStream({
      message: '请继续',
      history: [],
    }));
    expect(anthropicReply).toBe('anthropic reply');
    expect(fetchSpy).toHaveBeenNthCalledWith(
      1,
      'http://anthropic.example.com/v1/messages',
      expect.objectContaining({
        method: 'POST',
      }),
    );

    config.ANTHROPIC_API_KEY = '';
    config.ANTHROPIC_AUTH_TOKEN = '';
    config.OPENAI_API_KEY = 'openai-token';

    const openaiReply = await collectChunks(client.replyStream({
      message: '再继续',
      history: [],
    }));
    expect(openaiReply).toBe('openai reply');
    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      'http://openai.example.com/v1/responses',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });
});
