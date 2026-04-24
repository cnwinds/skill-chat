import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../config/env.js';
import { createDatabase, migrateDatabase, type AppDatabase } from '../../db/database.js';
import { SystemSettingsService } from './system-settings-service.js';

const createConfig = (root: string, overrides: Partial<AppConfig> = {}): AppConfig => ({
  NODE_ENV: 'test',
  PORT: 3000,
  WEB_ORIGIN: 'http://localhost:5173',
  DATA_ROOT: root,
  SKILLS_ROOT: path.join(root, 'skills'),
  DB_PATH: path.join(root, 'skillchat.sqlite'),
  CWD: root,
  INLINE_JOBS: true,
  JWT_SECRET: 'test-secret',
  JWT_EXPIRES_IN: '7d',
  OPENAI_BASE_URL: 'http://example.com/v1',
  OPENAI_API_KEY: 'env-token',
  OPENAI_MODEL: 'gpt-5.4',
  MODEL_CONTEXT_WINDOW_TOKENS: undefined,
  MODEL_AUTO_COMPACT_TOKEN_LIMIT: undefined,
  WEB_SEARCH_MODE: 'live',
  OPENAI_REASONING_EFFORT: 'medium',
  LLM_MAX_OUTPUT_TOKENS: 8192,
  TOOL_MAX_OUTPUT_TOKENS: 4096,
  ENABLE_ASSISTANT_TOOLS: true,
  LLM_REQUEST_TIMEOUT_MS: 45_000,
  STREAM_MAX_RETRIES: 5,
  STREAM_BACKOFF_BASE_MS: 1_000,
  STREAM_BACKOFF_MULTIPLIER: 2,
  ENABLE_TOKEN_TRACKING: true,
  ENABLE_REASONING_EVENTS: false,
  MAX_CONCURRENT_RUNS: 5,
  RUN_TIMEOUT_MS: 120_000,
  USER_STORAGE_QUOTA_MB: 1024,
  ...overrides,
});

const setSystemSetting = (db: AppDatabase, key: string, value: string) => {
  db.prepare(`
    INSERT INTO system_settings (key, value)
    VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
};

describe('SystemSettingsService', () => {
  const cleanup: Array<{ root: string; db: AppDatabase }> = [];

  afterEach(async () => {
    while (cleanup.length > 0) {
      const item = cleanup.pop();
      item?.db.close();
      if (item) {
        await fs.rm(item.root, { recursive: true, force: true });
      }
    }
  });

  const createDb = async (overrides: Partial<AppConfig> = {}) => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'skillchat-system-settings-'));
    const config = createConfig(root, overrides);
    const db = createDatabase(config);
    migrateDatabase(db);
    cleanup.push({ root, db });
    return { config, db };
  };

  it('keeps persisted settings as the source of truth in development', async () => {
    const { config, db } = await createDb({
      NODE_ENV: 'development',
      WEB_ORIGIN: 'http://localhost:5173',
      OPENAI_BASE_URL: 'http://env-host/v1',
      OPENAI_API_KEY: 'env-api-key',
      OPENAI_MODEL: 'gpt-5.4',
      OPENAI_REASONING_EFFORT: 'medium',
      LLM_MAX_OUTPUT_TOKENS: 10240,
      TOOL_MAX_OUTPUT_TOKENS: 4096,
      ENABLE_ASSISTANT_TOOLS: true,
    });

    setSystemSetting(db, 'registration_requires_invite_code', 'false');
    setSystemSetting(db, 'enable_assistant_tools', 'false');
    setSystemSetting(db, 'web_origin', 'http://localhost:3001');
    setSystemSetting(db, 'openai_base_url', 'http://stale-host/v1');
    setSystemSetting(db, 'openai_api_key', 'stale-api-key');
    setSystemSetting(db, 'openai_model', 'gpt-5.3');
    setSystemSetting(db, 'openai_reasoning_effort', 'low');
    setSystemSetting(db, 'llm_max_output_tokens', '2048');
    setSystemSetting(db, 'tool_max_output_tokens', '1024');

    const service = new SystemSettingsService(db, config);
    service.initialize();

    const settings = service.getSettings();
    expect(settings.registrationRequiresInviteCode).toBe(false);
    expect(settings.enableAssistantTools).toBe(false);
    expect(settings.webOrigin).toBe('http://localhost:3001');
    expect(settings.modelConfig.openaiBaseUrl).toBe('http://stale-host/v1');
    expect(settings.modelConfig.openaiApiKey).toBe('stale-api-key');
    expect(settings.modelConfig.openaiModel).toBe('gpt-5.3');
    expect(settings.modelConfig.openaiReasoningEffort).toBe('low');
    expect(settings.modelConfig.llmMaxOutputTokens).toBe(2048);
    expect(settings.modelConfig.toolMaxOutputTokens).toBe(1024);

    const rows = new Map(
      (
        db.prepare('SELECT key, value FROM system_settings').all() as Array<{ key: string; value: string }>
      ).map((row) => [row.key, row.value]),
    );

    expect(rows.get('registration_requires_invite_code')).toBe('false');
    expect(rows.get('enable_assistant_tools')).toBe('false');
    expect(rows.get('web_origin')).toBe('http://localhost:3001');
    expect(rows.get('openai_base_url')).toBe('http://stale-host/v1');
    expect(rows.get('openai_api_key')).toBe('stale-api-key');
    expect(rows.get('openai_model')).toBe('gpt-5.3');
    expect(rows.get('openai_reasoning_effort')).toBe('low');
    expect(rows.get('llm_max_output_tokens')).toBe('2048');
    expect(rows.get('tool_max_output_tokens')).toBe('1024');

    expect(config.ENABLE_ASSISTANT_TOOLS).toBe(false);
    expect(config.WEB_ORIGIN).toBe('http://localhost:3001');
    expect(config.OPENAI_BASE_URL).toBe('http://stale-host/v1');
    expect(config.OPENAI_API_KEY).toBe('stale-api-key');
    expect(config.OPENAI_MODEL).toBe('gpt-5.3');
    expect(config.OPENAI_REASONING_EFFORT).toBe('low');
    expect(config.LLM_MAX_OUTPUT_TOKENS).toBe(2048);
    expect(config.TOOL_MAX_OUTPUT_TOKENS).toBe(1024);
  });

  it('keeps persisted settings as the source of truth in production', async () => {
    const { config, db } = await createDb({
      NODE_ENV: 'production',
      WEB_ORIGIN: 'http://localhost:5173',
      OPENAI_MODEL: 'gpt-5.4',
      OPENAI_REASONING_EFFORT: 'medium',
      ENABLE_ASSISTANT_TOOLS: true,
    });

    setSystemSetting(db, 'enable_assistant_tools', 'false');
    setSystemSetting(db, 'web_origin', 'https://app.example.com');
    setSystemSetting(db, 'openai_model', 'gpt-5.3');
    setSystemSetting(db, 'openai_reasoning_effort', 'low');

    const service = new SystemSettingsService(db, config);
    service.initialize();

    const settings = service.getSettings();
    expect(settings.enableAssistantTools).toBe(false);
    expect(settings.webOrigin).toBe('https://app.example.com');
    expect(settings.modelConfig.openaiModel).toBe('gpt-5.3');
    expect(settings.modelConfig.openaiReasoningEffort).toBe('low');

    expect(config.ENABLE_ASSISTANT_TOOLS).toBe(false);
    expect(config.WEB_ORIGIN).toBe('https://app.example.com');
    expect(config.OPENAI_MODEL).toBe('gpt-5.3');
    expect(config.OPENAI_REASONING_EFFORT).toBe('low');
  });

  it('persists default runtime settings when the database is empty', async () => {
    const { config, db } = await createDb({
      NODE_ENV: 'development',
      WEB_ORIGIN: 'http://localhost:5173',
      OPENAI_BASE_URL: 'http://env-host/v1',
      OPENAI_API_KEY: 'env-api-key',
      OPENAI_MODEL: 'gpt-5.4',
      OPENAI_REASONING_EFFORT: 'medium',
      LLM_MAX_OUTPUT_TOKENS: 10240,
      TOOL_MAX_OUTPUT_TOKENS: 4096,
      ENABLE_ASSISTANT_TOOLS: true,
    });

    const service = new SystemSettingsService(db, config);
    service.initialize();

    const settings = service.getSettings();
    expect(settings.enableAssistantTools).toBe(true);
    expect(settings.webOrigin).toBe('http://localhost:5173');
    expect(settings.modelConfig.openaiBaseUrl).toBe('http://env-host/v1');
    expect(settings.modelConfig.openaiApiKey).toBe('env-api-key');
    expect(settings.modelConfig.openaiModel).toBe('gpt-5.4');
    expect(settings.modelConfig.openaiReasoningEffort).toBe('medium');
    expect(settings.modelConfig.llmMaxOutputTokens).toBe(10240);
    expect(settings.modelConfig.toolMaxOutputTokens).toBe(4096);
  });
});
