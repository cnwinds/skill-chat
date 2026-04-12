import { runWithInactivityTimeout } from './inactivity-timeout.js';

type JsonObject = Record<string, unknown>;

export type OpenAIResponsesInputMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type OpenAIResponsesStreamEvent = {
  event: string;
  data: unknown;
};

type StreamResponsesOptions = {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  body: Record<string, unknown>;
  signal?: AbortSignal;
};

const isRecord = (value: unknown): value is JsonObject => typeof value === 'object' && value !== null;

const parseEventBlock = (block: string): OpenAIResponsesStreamEvent | null => {
  let event = 'message';
  const dataLines: string[] = [];

  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) {
      continue;
    }

    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
      continue;
    }

    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  const rawData = dataLines.join('\n').trim();
  if (!rawData || rawData === '[DONE]') {
    return null;
  }

  try {
    return {
      event,
      data: JSON.parse(rawData),
    };
  } catch {
    return {
      event,
      data: rawData,
    };
  }
};

const toErrorMessage = (value: unknown) => {
  if (!isRecord(value)) {
    return '';
  }

  if (typeof value.message === 'string') {
    return value.message;
  }

  if (isRecord(value.error) && typeof value.error.message === 'string') {
    return value.error.message;
  }

  return '';
};

const maybeThrowStreamError = (event: OpenAIResponsesStreamEvent) => {
  if (event.event === 'error') {
    const message = toErrorMessage(event.data) || 'OpenAI Responses stream failed';
    throw new Error(message);
  }

  if (isRecord(event.data) && typeof event.data.type === 'string' && /failed|error/.test(event.data.type)) {
    const message = toErrorMessage(event.data) || `OpenAI Responses event failed: ${event.data.type}`;
    throw new Error(message);
  }
};

export const isOpenAIResponsesRecord = isRecord;

export async function* streamOpenAIResponsesEvents(options: StreamResponsesOptions): AsyncIterable<OpenAIResponsesStreamEvent> {
  const controller = new AbortController();
  const forwardAbort = () => {
    controller.abort(options.signal?.reason);
  };
  options.signal?.addEventListener('abort', forwardAbort, { once: true });
  const response = await runWithInactivityTimeout({
    timeoutMs: options.timeoutMs,
    controller,
    task: () => fetch(`${options.baseUrl.replace(/\/+$/, '')}/responses`, {
      method: 'POST',
          signal: controller.signal,
          headers: {
            'content-type': 'application/json',
            Authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        ...options.body,
        stream: true,
      }),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI Responses request failed: ${response.status} ${body}`.trim());
  }

  if (!response.body) {
    throw new Error('OpenAI Responses response body is empty');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await runWithInactivityTimeout({
        timeoutMs: options.timeoutMs,
        controller,
        task: () => reader.read(),
      });
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      let separatorIndex = buffer.indexOf('\n\n');
      while (separatorIndex >= 0) {
        const block = buffer.slice(0, separatorIndex).trim();
        buffer = buffer.slice(separatorIndex + 2);

        if (block) {
          const parsed = parseEventBlock(block);
          if (parsed) {
            maybeThrowStreamError(parsed);
            yield parsed;
          }
        }

        separatorIndex = buffer.indexOf('\n\n');
      }
    }

    const tail = buffer.trim();
    if (tail) {
      const parsed = parseEventBlock(tail);
      if (parsed) {
        maybeThrowStreamError(parsed);
        yield parsed;
      }
    }
  } finally {
    options.signal?.removeEventListener('abort', forwardAbort);
  }
}

export async function* streamOpenAIResponsesText(options: StreamResponsesOptions): AsyncIterable<string> {
  let hasContent = false;

  for await (const event of streamOpenAIResponsesEvents(options)) {
    if (!isRecord(event.data)) {
      continue;
    }

    if (event.event !== 'response.output_text.delta') {
      continue;
    }

    if (typeof event.data.delta !== 'string' || event.data.delta.length === 0) {
      continue;
    }

    hasContent = true;
    yield event.data.delta;
  }

  if (!hasContent) {
    throw new Error('OpenAI Responses stream returned empty text');
  }
}
