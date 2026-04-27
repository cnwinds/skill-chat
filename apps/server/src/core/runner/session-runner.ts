import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { AppConfig } from '../../config/env.js';
import { assertPathInside, listFilesRecursively } from '../storage/fs-utils.js';
import {
  getSessionOutputsRoot,
  getSessionRoot,
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
    scriptPath: string;
    argv?: string[];
    workingDirectory?: {
      root?: 'session' | 'workspace';
      path?: string;
    };
    signal?: AbortSignal;
    callbacks: RunnerCallbacks;
  }) {
    const sessionRoot = getSessionRoot(this.config, this.userId, this.sessionId);
    const outputDir = getSessionOutputsRoot(this.config, this.userId, this.sessionId);
    const uploadsDir = getSessionUploadsRoot(this.config, this.userId, this.sessionId);
    const sharedDir = getSharedRoot(this.config, this.userId);
    const workDirBase = args.workingDirectory?.root === 'workspace'
      ? this.config.CWD
      : sessionRoot;
    const requestedWorkDir = args.workingDirectory?.path?.trim() ?? '';
    const workDir = requestedWorkDir
      ? path.resolve(workDirBase, requestedWorkDir)
      : workDirBase;
    assertPathInside(workDirBase, workDir);

    const beforeSnapshot = new Set(await listFilesRecursively(outputDir));

    if (args.signal?.aborted) {
      throw args.signal.reason instanceof Error
        ? args.signal.reason
        : new DOMException('Turn interrupted', 'AbortError');
    }

    const entryPath = path.isAbsolute(args.scriptPath)
      ? path.resolve(args.scriptPath)
      : path.resolve(this.config.CWD, args.scriptPath);
    const allowedScriptRoots = [this.config.CWD, this.config.INSTALLED_SKILLS_ROOT];
    const isAllowedScriptPath = allowedScriptRoots.some((root) => {
      try {
        assertPathInside(root, entryPath);
        return true;
      } catch {
        return false;
      }
    });
    if (!isAllowedScriptPath) {
      throw new Error('脚本路径不在允许的工作区或已安装 Skill 目录内');
    }

    const extension = path.extname(entryPath).toLowerCase();
    const venvPython = path.join(this.config.CWD, '.venv', 'bin', 'python');
    let command: string;

    if (extension === '.js' || extension === '.mjs' || extension === '.cjs') {
      command = 'node';
    } else if (extension === '.py') {
      command = existsSync(venvPython) ? venvPython : 'python3';
    } else if (extension === '.sh' || extension === '.bash' || extension === '.zsh') {
      command = extension === '.zsh' ? 'zsh' : 'bash';
    } else {
      throw new Error(`不支持执行该脚本类型：${args.scriptPath}`);
    }

    const commandArgs = [entryPath, ...(args.argv ?? [])];

    await args.callbacks.onProgress('任务进入执行队列', undefined, 'running');

    let lastObservedMessage = '';
    const emittedArtifacts = new Set<string>();

    const child = spawn(command, commandArgs, {
      cwd: workDir,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        SKILLCHAT_WORKSPACE_ROOT: this.config.CWD,
        SKILLCHAT_SESSION_ROOT: sessionRoot,
        SKILLCHAT_UPLOADS_DIR: uploadsDir,
        SKILLCHAT_OUTPUTS_DIR: outputDir,
        SKILLCHAT_SHARED_DIR: sharedDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: this.config.RUN_TIMEOUT_MS,
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
          lastObservedMessage = payload.message ?? lastObservedMessage;
          await args.callbacks.onProgress(payload.message ?? '执行中', payload.percent, payload.status);
          return;
        }

        if (payload.type === 'artifact' && payload.path) {
          const absolutePath = path.resolve(workDir, payload.path);
          assertPathInside(outputDir, absolutePath);
          if (!emittedArtifacts.has(absolutePath)) {
            emittedArtifacts.add(absolutePath);
            await args.callbacks.onArtifact({
              absolutePath,
              label: payload.label,
            });
          }
          return;
        }

        if (payload.type === 'result') {
          lastObservedMessage = payload.message ?? lastObservedMessage;
          await args.callbacks.onProgress(payload.message ?? '执行完成', 100, 'completed');
          return;
        }
      } catch {
        lastObservedMessage = trimmed;
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
      let abortError: Error | DOMException | null = null;

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
        abortError = args.signal?.reason instanceof Error
          ? args.signal.reason
          : new DOMException('Turn interrupted', 'AbortError');

        if (child.exitCode === null) {
          child.kill('SIGTERM');
          abortTimer = setTimeout(() => {
            if (child.exitCode === null) {
              child.kill('SIGKILL');
            }
          }, 250);
        }
      };

      child.once('error', (error) => {
        finalize(() => reject(error));
      });
      child.once('close', (code) => {
        finalize(() => {
          if (abortError || args.signal?.aborted) {
            reject(
              abortError
              ?? (
                args.signal?.reason instanceof Error
                  ? args.signal.reason
                  : new DOMException('Turn interrupted', 'AbortError')
              ),
            );
            return;
          }

          if (code === 0) {
            resolve();
            return;
          }

          reject(new Error(lastObservedMessage || `脚本退出码异常：${code}`));
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
      if (!beforeSnapshot.has(filePath) && !emittedArtifacts.has(filePath)) {
        emittedArtifacts.add(filePath);
        await args.callbacks.onArtifact({
          absolutePath: filePath,
        });
      }
    }
  }
}
