const STREAM_TIMEOUT_MESSAGE = 'The operation was aborted due to timeout';

export const createStreamTimeoutError = () => new DOMException(STREAM_TIMEOUT_MESSAGE, 'TimeoutError');

export async function runWithInactivityTimeout<T>(args: {
  timeoutMs: number;
  controller: AbortController;
  task: () => Promise<T>;
}): Promise<T> {
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0) {
    return args.task();
  }

  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const timeoutError = createStreamTimeoutError();
      args.controller.abort(timeoutError);
      reject(timeoutError);
    }, args.timeoutMs);
  });

  try {
    return await Promise.race([args.task(), timeoutPromise]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
