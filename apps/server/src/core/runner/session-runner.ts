import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { nanoid } from 'nanoid';
import type { AppConfig } from '../../config/env.js';
import type { RegisteredSkill } from '../../modules/skills/skill-registry.js';
import { assertPathInside, listFilesRecursively } from '../storage/fs-utils.js';
import {
  getSessionOutputsRoot,
  getSessionRoot,
  getSessionTmpRoot,
  getSharedRoot,
  getSessionUploadsRoot,
} from '../storage/paths.js';

export interface RunnerArtifact {
  absolutePath: string;
  label?: string;
}

export interface RunnerCallbacks {
  onProgress: (message: string, percent?: number, status?: string) => Promise<void> | void;
  onArtifact: (artifact: RunnerArtifact) => Promise<void> | void;
}

export class SessionRunner {
  constructor(
    private readonly config: AppConfig,
    private readonly userId: string,
    private readonly sessionId: string,
  ) {}

  async run(args: {
    skill: RegisteredSkill;
    prompt: string;
    toolArguments: Record<string, unknown>;
    files: Array<{ name: string; path: string; mimeType: string | null }>;
    signal?: AbortSignal;
    callbacks: RunnerCallbacks;
  }) {
    const workDir = getSessionRoot(this.config, this.userId, this.sessionId);
    const outputDir = getSessionOutputsRoot(this.config, this.userId, this.sessionId);
    const tmpDir = getSessionTmpRoot(this.config, this.userId, this.sessionId);
    const uploadsDir = getSessionUploadsRoot(this.config, this.userId, this.sessionId);
    const sharedDir = getSharedRoot(this.config, this.userId);

    await fs.mkdir(tmpDir, { recursive: true });
    const requestPath = path.join(tmpDir, `run-${nanoid()}.json`);

    const beforeSnapshot = new Set(await listFilesRecursively(outputDir));

    const requestPayload = {
      runId: nanoid(),
      skill: args.skill.name,
      user: {
        id: this.userId,
      },
      session: {
        id: this.sessionId,
        workDir,
        uploadsDir,
        outputDir,
        sharedDir,
      },
      input: {
        prompt: args.prompt,
        arguments: args.toolArguments,
        files: args.files,
      },
    };

    await fs.writeFile(requestPath, JSON.stringify(requestPayload, null, 2), 'utf8');

    if (args.signal?.aborted) {
      throw args.signal.reason instanceof Error
        ? args.signal.reason
        : new DOMException('Turn interrupted', 'AbortError');
    }

    const entryPath = path.join(args.skill.directory, args.skill.entrypoint);
    const venvPython = path.join(this.config.CWD, '.venv', 'bin', 'python');
    const command = args.skill.runtime === 'node'
      ? 'node'
      : existsSync(venvPython)
        ? venvPython
        : 'python3';
    const commandArgs = [entryPath, '--request', requestPath];

    await args.callbacks.onProgress('任务进入执行队列', undefined, 'running');

    const child = spawn(command, commandArgs, {
      cwd: workDir,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: Math.min(this.config.RUN_TIMEOUT_MS, args.skill.timeoutSec * 1000),
    });

    const handleLine = async (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return;
      }

      try {
        const payload = JSON.parse(trimmed) as {
          type?: string;
          message?: string;
          percent?: number;
          path?: string;
          label?: string;
          status?: string;
        };

        if (payload.type === 'progress') {
          await args.callbacks.onProgress(payload.message ?? '执行中', payload.percent, payload.status);
          return;
        }

        if (payload.type === 'artifact' && payload.path) {
          const absolutePath = path.resolve(workDir, payload.path);
          assertPathInside(outputDir, absolutePath);
          await args.callbacks.onArtifact({
            absolutePath,
            label: payload.label,
          });
          return;
        }

        if (payload.type === 'result') {
          await args.callbacks.onProgress(payload.message ?? '执行完成', 100, 'completed');
          return;
        }
      } catch {
        await args.callbacks.onProgress(trimmed, undefined, 'running');
      }
    };

    const stdoutReader = readline.createInterface({ input: child.stdout });
    const stderrReader = readline.createInterface({ input: child.stderr });

    const linePromises: Promise<void>[] = [];
    stdoutReader.on('line', (line) => {
      linePromises.push(Promise.resolve(handleLine(line)));
    });
    stderrReader.on('line', (line) => {
      linePromises.push(Promise.resolve(handleLine(line)));
    });

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let abortTimer: ReturnType<typeof setTimeout> | null = null;

      const finalize = (callback: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        if (abortTimer) {
          clearTimeout(abortTimer);
        }
        args.signal?.removeEventListener('abort', onAbort);
        callback();
      };

      const onAbort = () => {
        if (child.exitCode === null) {
          child.kill('SIGTERM');
          abortTimer = setTimeout(() => {
            if (child.exitCode === null) {
              child.kill('SIGKILL');
            }
          }, 250);
        }

        finalize(() => {
          reject(
            args.signal?.reason instanceof Error
              ? args.signal.reason
              : new DOMException('Turn interrupted', 'AbortError'),
          );
        });
      };

      child.once('error', (error) => {
        finalize(() => reject(error));
      });
      child.once('close', (code) => {
        finalize(() => {
          if (args.signal?.aborted) {
            reject(
              args.signal.reason instanceof Error
                ? args.signal.reason
                : new DOMException('Turn interrupted', 'AbortError'),
            );
            return;
          }

          if (code === 0) {
            resolve();
            return;
          }

          reject(new Error(`Skill exited with code ${code}`));
        });
      });

      if (args.signal?.aborted) {
        onAbort();
      } else {
        args.signal?.addEventListener('abort', onAbort, { once: true });
      }
    });

    await Promise.allSettled(linePromises);

    const afterSnapshot = await listFilesRecursively(outputDir);
    for (const filePath of afterSnapshot) {
      if (!beforeSnapshot.has(filePath)) {
        await args.callbacks.onArtifact({
          absolutePath: filePath,
        });
      }
    }
  }
}
