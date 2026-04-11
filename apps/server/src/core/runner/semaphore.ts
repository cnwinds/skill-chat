export class Semaphore {
  private current = 0;
  private readonly queue: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async withLock<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private async acquire() {
    if (this.current < this.max) {
      this.current += 1;
      return;
    }

    await new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
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
