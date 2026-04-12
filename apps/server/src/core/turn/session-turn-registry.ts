import type { PersistedRuntimeState } from './turn-types.js';
import { SessionTurnRuntime } from './session-turn-runtime.js';

export class SessionTurnRegistry {
  private readonly runtimes = new Map<string, SessionTurnRuntime>();
  private readonly loading = new Map<string, Promise<SessionTurnRuntime | null>>();

  constructor(
    private readonly loadPersistedState: (userId: string, sessionId: string) => Promise<PersistedRuntimeState | null>,
    private readonly createRuntime: (
      userId: string,
      sessionId: string,
      initialState: PersistedRuntimeState | null,
      onBecameIdle: () => void,
    ) => SessionTurnRuntime,
  ) {}

  async getOrCreate(userId: string, sessionId: string) {
    const existing = this.runtimes.get(`${userId}:${sessionId}`);
    if (existing) {
      return existing;
    }

    const loaded = await this.loadRuntime(userId, sessionId, true);
    if (!loaded) {
      throw new Error('无法初始化会话运行态');
    }
    return loaded;
  }

  async get(userId: string, sessionId: string) {
    const existing = this.runtimes.get(`${userId}:${sessionId}`);
    if (existing) {
      return existing;
    }

    return this.loadRuntime(userId, sessionId, false);
  }

  private async loadRuntime(userId: string, sessionId: string, allowCreate: boolean) {
    const key = `${userId}:${sessionId}`;
    const existing = this.runtimes.get(key);
    if (existing) {
      return existing;
    }

    const pending = this.loading.get(key);
    if (pending) {
      return pending;
    }

    const task = (async () => {
      const initialState = await this.loadPersistedState(userId, sessionId);
      if (!allowCreate && !initialState) {
        return null;
      }

      const runtime = this.createRuntime(userId, sessionId, initialState, () => {
        const current = this.runtimes.get(key);
        if (current === runtime && current.isIdle()) {
          this.runtimes.delete(key);
        }
      });
      this.runtimes.set(key, runtime);
      return runtime;
    })();

    this.loading.set(key, task);

    try {
      return await task;
    } finally {
      if (this.loading.get(key) === task) {
        this.loading.delete(key);
      }
    }
  }
}
