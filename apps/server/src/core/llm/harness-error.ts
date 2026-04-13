export type HarnessErrorKind =
  | 'context_window_exceeded'
  | 'usage_limit_reached'
  | 'stream_disconnected'
  | 'turn_aborted'
  | 'tool_execution_failed'
  | 'unknown';

export class HarnessError extends Error {
  constructor(
    readonly kind: HarnessErrorKind,
    message: string,
    readonly retryable = false,
    readonly httpStatus?: number,
    readonly serverDelayMs?: number,
    readonly fallbackTransport?: 'http',
  ) {
    super(message);
    this.name = 'HarnessError';
  }
}

export const isHarnessError = (error: unknown): error is HarnessError => error instanceof HarnessError;

export const toHarnessError = (error: unknown): HarnessError => {
  if (isHarnessError(error)) {
    return error;
  }

  if (error instanceof DOMException && error.name === 'AbortError') {
    return new HarnessError('turn_aborted', error.message, false);
  }

  if (error instanceof Error && /abort|interrupted/i.test(error.message)) {
    return new HarnessError('turn_aborted', error.message, false);
  }

  const message = error instanceof Error ? error.message : String(error);
  if (/context window|maximum context length|too many tokens/i.test(message)) {
    return new HarnessError('context_window_exceeded', message, true);
  }
  if (/rate limit|quota|usage limit|429/i.test(message)) {
    return new HarnessError('usage_limit_reached', message, true);
  }
  if (/stream|timeout|socket|connect|network|disconnect/i.test(message)) {
    return new HarnessError('stream_disconnected', message, true);
  }

  return new HarnessError('unknown', message, false);
};
