import { runWithInactivityTimeout } from './inactivity-timeout.js';
import { HarnessError } from './harness-error.js';

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

const toRetryDelayMs = (retryAfter: string | null) => {
  if (!retryAfter) {
    return undefined;
  }

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  const retryDate = Date.parse(retryAfter);
  if (Number.isFinite(retryDate)) {
    return Math.max(0, retryDate - Date.now());
  }

  return undefined;
};

const maybeThrowStreamError = (event: OpenAIResponsesStreamEvent) => {
  if (event.event === 'error') {
    const message = toErrorMessage(event.data) || 'OpenAI Responses stream failed';
    throw new HarnessError('stream_disconnected', message, true);
  }

  if (isRecord(event.data) && typeof event.data.type === 'string' && /failed|error/.test(event.data.type)) {
    const message = toErrorMessage(event.data) || `OpenAI Responses event failed: ${event.data.type}`;
    throw new HarnessError('stream_disconnected', message, true);
  }
};

export const isOpenAIResponsesRecord = isRecord;

const responsesCompatibilityCache = new Map<string, {
  omitMaxOutputTokens: boolean;
}>();

const createResponsesRequestBody = (
  baseUrl: string,
  body: Record<string, unknown>,
  options: {
    omitMaxOutputTokens?: boolean;
  } = {},
) => {
  const cached = responsesCompatibilityCache.get(baseUrl.replace(/\/+$/, ''));
  if (options.omitMaxOutputTokens || cached?.omitMaxOutputTokens) {
    const { max_output_tokens: _maxOutputTokens, ...rest } = body;
    return {
      ...rest,
      stream: true,
    };
  }

  return {
    ...body,
    stream: true,
  };
};

const createResponsesRequest = async (
  controller: AbortController,
  options: StreamResponsesOptions,
  requestBody: Record<string, unknown>,
) => await runWithInactivityTimeout({
  timeoutMs: options.timeoutMs,
  controller,
  task: () => fetch(`${options.baseUrl.replace(/\/+$/, '')}/responses`, {
    method: 'POST',
    signal: controller.signal,
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify(requestBody),
  }),
});

const shouldRetryWithoutMaxOutputTokens = (
  response: Response,
  bodyText: string,
  requestBody: Record<string, unknown>,
) => (
  response.status === 400
  && Object.prototype.hasOwnProperty.call(requestBody, 'max_output_tokens')
  && /unsupported parameter:\s*max_output_tokens/i.test(bodyText)
);

export async function* streamOpenAIResponsesEvents(options: StreamResponsesOptions): AsyncIterable<OpenAIResponsesStreamEvent> {
  const controller = new AbortController();
  const normalizedBaseUrl = options.baseUrl.replace(/\/+$/, '');
  const forwardAbort = () => {
    controller.abort(options.signal?.reason);
  };
  options.signal?.addEventListener('abort', forwardAbort, { once: true });
  let requestBody = createResponsesRequestBody(normalizedBaseUrl, options.body);
  let response = await createResponsesRequest(controller, options, requestBody);

  if (!response.ok) {
    let body = await response.text();
    if (shouldRetryWithoutMaxOutputTokens(response, body, requestBody)) {
      responsesCompatibilityCache.set(normalizedBaseUrl, { omitMaxOutputTokens: true });
      requestBody = createResponsesRequestBody(normalizedBaseUrl, options.body, { omitMaxOutputTokens: true });
      response = await createResponsesRequest(controller, options, requestBody);
      body = response.ok ? '' : await response.text();
    }

    if (!response.ok) {
      const message = `OpenAI Responses request failed: ${response.status} ${body}`.trim();
      const retryDelayMs = toRetryDelayMs(response.headers.get('retry-after'));
      if (response.status === 429) {
        throw new HarnessError('usage_limit_reached', message, true, response.status, retryDelayMs);
      }
      if (response.status >= 500 || response.status === 408) {
        throw new HarnessError('stream_disconnected', message, true, response.status, retryDelayMs, 'http');
      }
      if (response.status === 400 && /context|token/i.test(body)) {
        throw new HarnessError('context_window_exceeded', message, true, response.status);
      }
      throw new HarnessError('unknown', message, false, response.status);
    }
  }

  if (!response.body) {
    throw new HarnessError('stream_disconnected', 'OpenAI Responses response body is empty', true);
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
