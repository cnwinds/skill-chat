import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppConfig } from '../../config/env.js';
import { getSessionContextStatePath } from '../../core/storage/paths.js';

export type SessionCompactionTrigger = 'manual' | 'auto';

export type SessionCompactionState = {
  summary: string;
  createdAt: string;
  baselineCreatedAt: string | null;
  trigger: SessionCompactionTrigger;
};

export type SessionContextState = {
  version: 1;
  latestCompaction: SessionCompactionState | null;
};

const emptyState = (): SessionContextState => ({
  version: 1,
  latestCompaction: null,
});

export class SessionContextStore {
  constructor(private readonly config: AppConfig) {}

  async load(userId: string, sessionId: string): Promise<SessionContextState> {
    const filePath = getSessionContextStatePath(this.config, userId, sessionId);

    try {
      const content = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(content) as Partial<SessionContextState> | null;
      if (!parsed || parsed.version !== 1) {
        return emptyState();
      }

      return {
        version: 1,
        latestCompaction: parsed.latestCompaction
          ? {
              summary: typeof parsed.latestCompaction.summary === 'string' ? parsed.latestCompaction.summary : '',
              createdAt: typeof parsed.latestCompaction.createdAt === 'string' ? parsed.latestCompaction.createdAt : new Date().toISOString(),
              baselineCreatedAt: typeof parsed.latestCompaction.baselineCreatedAt === 'string'
                ? parsed.latestCompaction.baselineCreatedAt
                : null,
              trigger: parsed.latestCompaction.trigger === 'manual' ? 'manual' : 'auto',
            }
          : null,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return emptyState();
      }
      throw error;
    }
  }

  async save(userId: string, sessionId: string, state: SessionContextState) {
    const filePath = getSessionContextStatePath(this.config, userId, sessionId);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(state, null, 2), 'utf8');
  }

  async clear(userId: string, sessionId: string) {
    const filePath = getSessionContextStatePath(this.config, userId, sessionId);
    await fs.rm(filePath, { force: true });
  }
}
