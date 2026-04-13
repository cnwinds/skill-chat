import path from 'node:path';
import type { FileRecord } from '@skillchat/shared';
import type { AppConfig } from '../../config/env.js';
import { Semaphore } from './semaphore.js';
import { SessionRunner } from './session-runner.js';
import { FileService } from '../../modules/files/file-service.js';

export class RunnerManager {
  private readonly semaphore: Semaphore;
  private readonly sessionQueues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly config: AppConfig,
    private readonly fileService: FileService,
  ) {
    this.semaphore = new Semaphore(config.MAX_CONCURRENT_RUNS);
  }

  execute(args: {
    userId: string;
    sessionId: string;
    scriptPath: string;
    argv?: string[];
    cwdRoot?: 'session' | 'workspace';
    cwdPath?: string;
    signal?: AbortSignal;
    onQueued?: () => Promise<void> | void;
    onProgress: (message: string, percent?: number, status?: string) => Promise<void> | void;
    onArtifact: (file: FileRecord) => Promise<void> | void;
  }) {
    const queueKey = `${args.userId}:${args.sessionId}`;
    const previous = this.sessionQueues.get(queueKey) ?? Promise.resolve();

    const task = previous
      .catch(() => undefined)
      .then(async () => {
        if (args.signal?.aborted) {
          throw args.signal.reason instanceof Error ? args.signal.reason : new DOMException('Turn interrupted', 'AbortError');
        }
        await args.onQueued?.();
        return this.semaphore.withLock(async () => {
          if (args.signal?.aborted) {
            throw args.signal.reason instanceof Error ? args.signal.reason : new DOMException('Turn interrupted', 'AbortError');
          }
          const runner = new SessionRunner(this.config, args.userId, args.sessionId);
          const seenPaths = new Set<string>();

          await runner.run({
            scriptPath: args.scriptPath,
            argv: args.argv ?? [],
            workingDirectory: {
              root: args.cwdRoot ?? 'session',
              path: args.cwdPath ?? '',
            },
            signal: args.signal,
            callbacks: {
              onProgress: args.onProgress,
              onArtifact: async (artifact) => {
                const normalizedPath = path.normalize(artifact.absolutePath);
                if (seenPaths.has(normalizedPath)) {
                  return;
                }
                seenPaths.add(normalizedPath);

                const record = await this.fileService.recordGeneratedFile({
                  userId: args.userId,
                  sessionId: args.sessionId,
                  absolutePath: normalizedPath,
                  displayName: artifact.label,
                });
                await args.onArtifact(record);
              },
            },
          });
        }, args.signal);
      });

    this.sessionQueues.set(queueKey, task);

    task.finally(() => {
      if (this.sessionQueues.get(queueKey) === task) {
        this.sessionQueues.delete(queueKey);
      }
    });

    return task;
  }
}
