import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../config/env.js';
import { SkillRegistry } from './skill-registry.js';

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
  IMAGE_THUMBNAIL_THRESHOLD_BYTES: 256 * 1024,
  IMAGE_THUMBNAIL_MAX_WIDTH: 640,
  IMAGE_THUMBNAIL_MAX_HEIGHT: 640,
  IMAGE_THUMBNAIL_QUALITY: 78,
  MAX_CONCURRENT_RUNS: 5,
  RUN_TIMEOUT_MS: 5000,
});

describe('SkillRegistry', () => {
  let tempDir: string;
  let config: AppConfig;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'skillchat-skill-registry-test-'));
    config = createConfig(tempDir);
    await fs.mkdir(config.SKILLS_ROOT, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('loads codex-style skill metadata from SKILL.md without runtime inference', async () => {
    const skillDir = path.join(config.SKILLS_ROOT, 'huashu-nuwa');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), [
      '---',
      'name: huashu-nuwa',
      'description: third-party skill without runtime metadata',
      'runtime: chat',
      'entrypoint: scripts/run.py',
      '---',
      '',
      '# Huashu Nuwa',
    ].join('\n'), 'utf8');

    const registry = new SkillRegistry(config);
    await registry.load();

    expect(registry.get('huashu-nuwa')).toMatchObject({
      name: 'huashu-nuwa',
      description: 'third-party skill without runtime metadata',
    });
  });

  it('preserves optional starter prompts for the skill picker ui', async () => {
    const skillDir = path.join(config.SKILLS_ROOT, 'zhangxuefeng-perspective');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), [
      '---',
      'name: zhangxuefeng-perspective',
      'description: career advice skill',
      'starter_prompts:',
      '  - 扮演张雪峰',
      '  - 帮我看志愿',
      '---',
      '',
      '# Zhang Xuefeng',
    ].join('\n'), 'utf8');

    const registry = new SkillRegistry(config);
    await registry.load();

    expect(registry.get('zhangxuefeng-perspective')).toMatchObject({
      starterPrompts: ['扮演张雪峰', '帮我看志愿'],
    });
  });
});
