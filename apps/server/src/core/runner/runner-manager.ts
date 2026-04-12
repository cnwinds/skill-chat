import path from 'node:path';
import type { FileRecord } from '@skillchat/shared';
import type { AppConfig } from '../../config/env.js';
import { resolveUserPath } from '../storage/paths.js';
import { Semaphore } from './semaphore.js';
import { SessionRunner } from './session-runner.js';
import type { RegisteredSkill } from '../../modules/skills/skill-registry.js';
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
    skill: RegisteredSkill;
    prompt: string;
    toolArguments: Record<string, unknown>;
    files: Array<{ name: string; relativePath: string; mimeType: string | null }>;
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
            skill: args.skill,
            prompt: args.prompt,
            toolArguments: args.toolArguments,
            files: args.files.map((file) => ({
              name: file.name,
              path: resolveUserPath(this.config, args.userId, file.relativePath),
              mimeType: file.mimeType,
            })),
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
