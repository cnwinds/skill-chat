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

  it('retries once without max_output_tokens when a compatible proxy rejects that parameter', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({
          detail: 'Unsupported parameter: max_output_tokens',
        }),
        {
          status: 400,
          headers: {
            'content-type': 'application/json',
          },
        },
      ))
      .mockResolvedValueOnce(createAbortAwareResponsesStream({
        items: [
          {
            delayMs: 0,
            event: 'response.output_text.delta',
            data: {
              type: 'response.output_text.delta',
              delta: '兼容回退成功',
            },
          },
        ],
      }));

    vi.stubGlobal('fetch', fetchSpy);

    const chunks: string[] = [];
    for await (const chunk of streamOpenAIResponsesText({
      apiKey: 'test-token',
      baseUrl: 'http://example.com/v1',
      timeoutMs: 200,
      body: {
        model: 'gpt-5.4',
        input: '你好',
        max_output_tokens: 256,
      },
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['兼容回退成功']);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    const firstPayload = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
    const secondPayload = JSON.parse(String(fetchSpy.mock.calls[1]?.[1]?.body));
    expect(firstPayload.max_output_tokens).toBe(256);
    expect(secondPayload.max_output_tokens).toBeUndefined();
    expect(secondPayload.stream).toBe(true);
  });

  it('remembers incompatible base urls and omits max_output_tokens on later requests', async () => {
    const fetchSpy = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({
          detail: 'Unsupported parameter: max_output_tokens',
        }),
        {
          status: 400,
          headers: {
            'content-type': 'application/json',
          },
        },
      ))
      .mockResolvedValueOnce(createAbortAwareResponsesStream({
        items: [
          {
            delayMs: 0,
            event: 'response.output_text.delta',
            data: {
              type: 'response.output_text.delta',
              delta: '第一次请求成功',
            },
          },
        ],
      }))
      .mockResolvedValueOnce(createAbortAwareResponsesStream({
        items: [
          {
            delayMs: 0,
            event: 'response.output_text.delta',
            data: {
              type: 'response.output_text.delta',
              delta: '第二次直接成功',
            },
          },
        ],
      }));

    vi.stubGlobal('fetch', fetchSpy);

    const readAll = async (input: string) => {
      const chunks: string[] = [];
      for await (const chunk of streamOpenAIResponsesText({
        apiKey: 'test-token',
        baseUrl: 'http://proxy.example.com/v1',
        timeoutMs: 200,
        body: {
          model: 'gpt-5.4',
          input,
          max_output_tokens: 256,
        },
      })) {
        chunks.push(chunk);
      }
      return chunks.join('');
    };

    await expect(readAll('第一次')).resolves.toBe('第一次请求成功');
    await expect(readAll('第二次')).resolves.toBe('第二次直接成功');
    expect(fetchSpy).toHaveBeenCalledTimes(3);

    const firstPayload = JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body));
    const secondPayload = JSON.parse(String(fetchSpy.mock.calls[1]?.[1]?.body));
    const thirdPayload = JSON.parse(String(fetchSpy.mock.calls[2]?.[1]?.body));
    expect(firstPayload.max_output_tokens).toBe(256);
    expect(secondPayload.max_output_tokens).toBeUndefined();
    expect(thirdPayload.max_output_tokens).toBeUndefined();
  });
});
