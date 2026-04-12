import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamOpenAIResponsesText } from './openai-responses.js';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const createAbortAwareResponsesStream = (args: {
  signal?: AbortSignal;
  items: Array<{ delayMs: number; event: string; data: unknown }>;
}) => new Response(
  new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;

      const abortHandler = () => {
        if (closed) {
          return;
        }
        closed = true;
        controller.error(args.signal?.reason ?? new DOMException('The operation was aborted', 'AbortError'));
      };

      args.signal?.addEventListener('abort', abortHandler, { once: true });

      void (async () => {
        try {
          for (const item of args.items) {
            await wait(item.delayMs);
            if (closed) {
              return;
            }
            controller.enqueue(encoder.encode(`event: ${item.event}\n`));
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(item.data)}\n\n`));
          }

          if (!closed) {
            closed = true;
            controller.close();
          }
        } catch (error) {
          if (!closed) {
            closed = true;
            controller.error(error);
          }
        } finally {
          args.signal?.removeEventListener('abort', abortHandler);
        }
      })();
    },
  }),
  {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
    },
  },
);

describe('streamOpenAIResponsesText', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('treats timeoutMs as inactivity timeout instead of total stream duration', async () => {
    vi.useFakeTimers();

    const fetchSpy = vi.fn((_url: string, init?: RequestInit) => Promise.resolve(
      createAbortAwareResponsesStream({
        signal: init?.signal instanceof AbortSignal ? init.signal : undefined,
        items: [
          {
            delayMs: 0,
            event: 'response.created',
            data: {
              type: 'response.created',
            },
          },
          {
            delayMs: 25,
            event: 'response.output_text.delta',
            data: {
              type: 'response.output_text.delta',
              delta: '你好',
            },
          },
          {
            delayMs: 25,
            event: 'response.output_text.delta',
            data: {
              type: 'response.output_text.delta',
              delta: '，世界',
            },
          },
        ],
      }),
    ));

    vi.stubGlobal('fetch', fetchSpy);

    const consumePromise = (async () => {
      const chunks: string[] = [];
      for await (const chunk of streamOpenAIResponsesText({
        apiKey: 'test-token',
        baseUrl: 'http://example.com/v1',
        timeoutMs: 40,
        body: {
          model: 'gpt-5.4',
          input: '你好',
        },
      })) {
        chunks.push(chunk);
      }
      return chunks;
    })();

    await vi.advanceTimersByTimeAsync(60);
    await expect(consumePromise).resolves.toEqual(['你好', '，世界']);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('propagates an external abort signal to the Responses stream', async () => {
    const fetchSpy = vi.fn((_url: string, init?: RequestInit) => Promise.resolve(
      createAbortAwareResponsesStream({
        signal: init?.signal instanceof AbortSignal ? init.signal : undefined,
        items: [
          {
            delayMs: 0,
            event: 'response.output_text.delta',
            data: {
              type: 'response.output_text.delta',
              delta: '第一段',
            },
          },
          {
            delayMs: 100,
            event: 'response.output_text.delta',
            data: {
              type: 'response.output_text.delta',
              delta: '第二段',
            },
          },
        ],
      }),
    ));

    vi.stubGlobal('fetch', fetchSpy);

    const controller = new AbortController();
    const iterator = streamOpenAIResponsesText({
      apiKey: 'test-token',
      baseUrl: 'http://example.com/v1',
      timeoutMs: 200,
      signal: controller.signal,
      body: {
        model: 'gpt-5.4',
        input: '你好',
      },
    })[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      value: '第一段',
      done: false,
    });

    controller.abort();
    await expect(iterator.next()).rejects.toThrow(/abort/i);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
