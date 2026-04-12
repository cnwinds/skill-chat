import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../config/env.js';
import { ensureBaseDirectories, ensureSessionDirectories, ensureUserDirectories } from '../storage/fs-utils.js';
import { SessionRunner } from './session-runner.js';

const createConfig = (rootDir: string): AppConfig => ({
  NODE_ENV: 'test',
  PORT: 3000,
  WEB_ORIGIN: 'http://localhost:5173',
  DATA_ROOT: path.join(rootDir, 'data'),
  SKILLS_ROOT: path.join(rootDir, 'skills'),
  DB_PATH: path.join(rootDir, 'skillchat.sqlite'),
  CWD: rootDir,
  INLINE_JOBS: true,
  JWT_SECRET: 'test-secret',
  JWT_EXPIRES_IN: '7d',
  OPENAI_BASE_URL: 'http://example.com/v1',
  OPENAI_API_KEY: '',
  OPENAI_MODEL: 'gpt-5.4',
  OPENAI_REASONING_EFFORT: 'medium',
  LLM_MAX_OUTPUT_TOKENS: 4096,
  TOOL_MAX_OUTPUT_TOKENS: 3072,
  ENABLE_ASSISTANT_TOOLS: true,
  LLM_REQUEST_TIMEOUT_MS: 1000,
  MAX_CONCURRENT_RUNS: 5,
  RUN_TIMEOUT_MS: 5000,
  USER_STORAGE_QUOTA_MB: 1024,
});

describe('SessionRunner', () => {
  let tempDir: string;
  let config: AppConfig;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skillchat-runner-test-'));
    config = createConfig(tempDir);
    await ensureBaseDirectories(config);
    await ensureUserDirectories(config, 'u1');
    await ensureSessionDirectories(config, 'u1', 's1', {
      sessionId: 's1',
      userId: 'u1',
      title: '测试会话',
      createdAt: '2026-04-12T00:00:00.000Z',
      updatedAt: '2026-04-12T00:00:00.000Z',
      activeSkills: [],
    });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('kills a running child process when the abort signal is triggered', async () => {
    const skillDir = path.join(tempDir, 'skills', 'long-runner');
    await fs.mkdir(skillDir, { recursive: true });
    const entryPath = path.join(skillDir, 'run.js');
    await fs.writeFile(entryPath, [
      "process.stdout.write(JSON.stringify({ type: 'progress', message: 'started', status: 'running' }) + '\\n');",
      "process.on('SIGTERM', () => {",
      "  process.stdout.write(JSON.stringify({ type: 'progress', message: 'ignoring-term', status: 'running' }) + '\\n');",
      "});",
      'setInterval(() => {}, 1000);',
    ].join('\n'), 'utf8');

    const runner = new SessionRunner(config, 'u1', 's1');
    const controller = new AbortController();
    let sawStarted = false;

    const runPromise = runner.run({
      skill: {
        name: 'long-runner',
        description: 'Long running test skill',
        entrypoint: 'run.js',
        runtime: 'node',
        timeoutSec: 120,
        references: [],
        directory: skillDir,
        markdown: '',
        referencesContent: [],
      },
      prompt: 'run',
      toolArguments: {},
      files: [],
      signal: controller.signal,
      callbacks: {
        onProgress: async (message) => {
          if (message === 'started') {
            sawStarted = true;
            controller.abort(new DOMException('Turn interrupted', 'AbortError'));
          }
        },
        onArtifact: async () => undefined,
      },
    });

    await expect(runPromise).rejects.toThrow(/interrupted/i);
    expect(sawStarted).toBe(true);
  });
});
