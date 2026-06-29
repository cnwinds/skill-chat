import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../config/env.js';
import { syncHarnessConfig, toHarnessConfig } from './harness-config.js';

const createConfig = (overrides: Partial<AppConfig> = {}): AppConfig => ({
  NODE_ENV: 'test',
  PORT: 3000,
  WEB_ORIGIN: 'http://localhost:5173',
  DATA_ROOT: '/data',
  SKILLS_ROOT: '/skills',
  MARKET_BASE_URL: 'http://localhost:3100',
  INSTALLED_SKILLS_ROOT: '/installed-skills',
  DB_PATH: '/data/skillchat.sqlite',
  CWD: '/',
  INLINE_JOBS: true,
  SESSION_EXPIRES_IN: '7d',
  OPENAI_BASE_URL: 'http://env-host/v1',
  OPENAI_API_KEY: 'env-token',
  OPENAI_MODEL: 'gpt-5.4',
  MODEL_CONTEXT_WINDOW_TOKENS: undefined,
  MODEL_AUTO_COMPACT_TOKEN_LIMIT: undefined,
  WEB_SEARCH_MODE: 'live',
  WEB_SEARCH_PROVIDERS: '',
  OPENAI_NATIVE_WEB_SEARCH: 'auto',
  TAVILY_API_KEY: '',
  SERPER_API_KEY: '',
  BRAVE_SEARCH_API_KEY: '',
  OPENAI_NATIVE_IMAGE_GENERATION: 'auto',
  IMAGE_PROVIDERS: '',
  OPENAI_IMAGE_API_KEY: '',
  OPENAI_IMAGE_BASE_URL: 'https://api.openai.com/v1',
  OPENAI_IMAGE_MODEL: 'gpt-image-2',
  ZHIPU_IMAGE_API_KEY: '',
  ZHIPU_IMAGE_BASE_URL: 'https://open.bigmodel.cn/api/paas/v4',
  ZHIPU_IMAGE_MODEL: 'glm-image',
  DASHSCOPE_IMAGE_API_KEY: '',
  DASHSCOPE_IMAGE_BASE_URL: 'https://dashscope.aliyuncs.com',
  DASHSCOPE_IMAGE_MODEL: 'wan2.1-t2i-turbo',
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
  IMAGE_THUMBNAIL_THRESHOLD_BYTES: 256 * 1024,
  IMAGE_THUMBNAIL_MAX_WIDTH: 640,
  IMAGE_THUMBNAIL_MAX_HEIGHT: 640,
  IMAGE_THUMBNAIL_QUALITY: 78,
  MAX_CONCURRENT_RUNS: 5,
  RUN_TIMEOUT_MS: 120_000,
  ...overrides,
});

describe('syncHarnessConfig', () => {
  it('updates mutable harness fields from AppConfig without recreating the object', () => {
    const config = createConfig();
    const harnessConfig = toHarnessConfig(config);

    config.OPENAI_BASE_URL = 'http://admin-host/v1';
    config.OPENAI_API_KEY = 'admin-token';
    config.OPENAI_MODEL = 'gpt-5.3';
    config.OPENAI_REASONING_EFFORT = 'low';
    config.OPENAI_NATIVE_WEB_SEARCH = 'off';
    config.OPENAI_NATIVE_IMAGE_GENERATION = 'on';
    config.WEB_SEARCH_MODE = 'cached';
    config.TAVILY_API_KEY = 'tvly-test';
    config.OPENAI_IMAGE_API_KEY = 'img-test';
    config.LLM_MAX_OUTPUT_TOKENS = 2048;
    config.TOOL_MAX_OUTPUT_TOKENS = 1024;
    config.ENABLE_ASSISTANT_TOOLS = false;

    syncHarnessConfig(config, harnessConfig);

    expect(harnessConfig.OPENAI_BASE_URL).toBe('http://admin-host/v1');
    expect(harnessConfig.OPENAI_API_KEY).toBe('admin-token');
    expect(harnessConfig.OPENAI_MODEL).toBe('gpt-5.3');
    expect(harnessConfig.OPENAI_REASONING_EFFORT).toBe('low');
    expect(harnessConfig.OPENAI_NATIVE_WEB_SEARCH).toBe('off');
    expect(harnessConfig.OPENAI_NATIVE_IMAGE_GENERATION).toBe('on');
    expect(harnessConfig.WEB_SEARCH_MODE).toBe('cached');
    expect(harnessConfig.TAVILY_API_KEY).toBe('tvly-test');
    expect(harnessConfig.OPENAI_IMAGE_API_KEY).toBe('img-test');
    expect(harnessConfig.LLM_MAX_OUTPUT_TOKENS).toBe(2048);
    expect(harnessConfig.TOOL_MAX_OUTPUT_TOKENS).toBe(1024);
    expect(harnessConfig.ENABLE_ASSISTANT_TOOLS).toBe(false);
    expect(harnessConfig.CWD).toBe('/');
  });
});
