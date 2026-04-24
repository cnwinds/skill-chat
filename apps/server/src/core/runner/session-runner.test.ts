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
  SESSION_EXPIRES_IN: '7d',
  OPENAI_BASE_URL: 'http://example.com/v1',
  OPENAI_API_KEY: '',
  OPENAI_MODEL: 'gpt-5.4',
  WEB_SEARCH_MODE: 'live',
  OPENAI_REASONING_EFFORT: 'medium',
  LLM_MAX_OUTPUT_TOKENS: 4096,
  TOOL_MAX_OUTPUT_TOKENS: 3072,
  ENABLE_ASSISTANT_TOOLS: true,
  LLM_REQUEST_TIMEOUT_MS: 1000,
  STREAM_MAX_RETRIES: 5,
  STREAM_BACKOFF_BASE_MS: 1000,
  STREAM_BACKOFF_MULTIPLIER: 2,
  ENABLE_TOKEN_TRACKING: true,
  ENABLE_REASONING_EVENTS: false,
  MAX_CONCURRENT_RUNS: 5,
  RUN_TIMEOUT_MS: 5000,
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
      scriptPath: 'skills/long-runner/run.js',
      argv: [],
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

  it('reports a generated artifact only once when the script also emits an artifact event', async () => {
    const skillDir = path.join(tempDir, 'skills', 'artifact-runner');
    await fs.mkdir(skillDir, { recursive: true });
    const entryPath = path.join(skillDir, 'run.js');
    await fs.writeFile(entryPath, [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const outputArg = process.argv[2];",
      "if (outputArg !== 'outputs/report.txt') { throw new Error(`unexpected argv: ${process.argv.slice(2).join(' ')}`); }",
      "const outputPath = path.resolve(process.cwd(), outputArg);",
      "fs.writeFileSync(outputPath, 'artifact body', 'utf8');",
      "process.stdout.write(JSON.stringify({ type: 'artifact', path: outputArg, label: 'report.txt' }) + '\\n');",
      "process.stdout.write(JSON.stringify({ type: 'result', message: 'done' }) + '\\n');",
    ].join('\n'), 'utf8');

    const runner = new SessionRunner(config, 'u1', 's1');
    const artifacts: string[] = [];

    await runner.run({
      scriptPath: 'skills/artifact-runner/run.js',
      argv: ['outputs/report.txt'],
      callbacks: {
        onProgress: async () => undefined,
        onArtifact: async (artifact) => {
          artifacts.push(artifact.absolutePath);
        },
      },
    });

    expect(artifacts).toEqual([
      path.join(config.DATA_ROOT, 'users', 'u1', 'sessions', 's1', 'outputs', 'report.txt'),
    ]);
  });
});
