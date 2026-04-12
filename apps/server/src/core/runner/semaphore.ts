export class Semaphore {
  private current = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async withLock<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.acquire(signal);
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private async acquire(signal?: AbortSignal) {
    if (signal?.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new DOMException('Task interrupted', 'AbortError');
    }

    if (this.current < this.max) {
      this.current += 1;
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const waiter = () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      };
      const onAbort = () => {
        const index = this.queue.indexOf(waiter);
        if (index >= 0) {
          this.queue.splice(index, 1);
        }
        reject(
          signal?.reason instanceof Error
            ? signal.reason
            : new DOMException('Task interrupted', 'AbortError'),
        );
      };

      this.queue.push(waiter);
      signal?.addEventListener('abort', onAbort, { once: true });
    });

    if (signal?.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new DOMException('Task interrupted', 'AbortError');
    }
    this.current += 1;
  }

  private release() {
    this.current -= 1;
    const next = this.queue.shift();
    if (next) {
      next();
    }
  }
}
