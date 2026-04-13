import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config as loadDotEnv } from 'dotenv';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATA_ROOT: z.string().default('./data'),
  SKILLS_ROOT: z.string().default('./skills'),
  JWT_SECRET: z.string().min(8).default('change-me-now'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  OPENAI_API_KEY: z.string().optional().default(''),
  OPENAI_MODEL: z.string().default('gpt-5.4'),
  MODEL_CONTEXT_WINDOW_TOKENS: z.coerce.number().int().positive().optional(),
  MODEL_AUTO_COMPACT_TOKEN_LIMIT: z.coerce.number().int().positive().optional(),
  WEB_SEARCH_MODE: z.enum(['disabled', 'cached', 'live']).default('live'),
  OPENAI_REASONING_EFFORT: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']).default('xhigh'),
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(10240),
  TOOL_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(4096),
  ENABLE_ASSISTANT_TOOLS: z.coerce.boolean().default(true),
  LLM_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(45000),
  STREAM_MAX_RETRIES: z.coerce.number().int().positive().default(5),
  STREAM_BACKOFF_BASE_MS: z.coerce.number().int().nonnegative().default(1000),
  STREAM_BACKOFF_MULTIPLIER: z.coerce.number().positive().default(2),
  ENABLE_TOKEN_TRACKING: z.coerce.boolean().default(true),
  ENABLE_REASONING_EVENTS: z.coerce.boolean().default(false),
  MAX_CONCURRENT_RUNS: z.coerce.number().int().positive().default(5),
  RUN_TIMEOUT_MS: z.coerce.number().int().positive().default(120_000),
  USER_STORAGE_QUOTA_MB: z.coerce.number().int().positive().default(1024),
});

export type AppConfig = z.infer<typeof envSchema> & {
  CWD: string;
  DATA_ROOT: string;
  SKILLS_ROOT: string;
  DB_PATH: string;
  INLINE_JOBS: boolean;
};

export type ConfigOverrides = Partial<Omit<AppConfig, 'DB_PATH'>>;

export const getProjectRoot = () => path.resolve(fileURLToPath(new URL('../../../../', import.meta.url)));

export const loadConfig = (cwd: string, overrides: ConfigOverrides = {}): AppConfig => {
  loadDotEnv({
    path: path.resolve(cwd, '.env'),
    override: false,
  });

  const raw = envSchema.parse({
    ...process.env,
    ...overrides,
    OPENAI_MODEL: overrides.OPENAI_MODEL ?? process.env.OPENAI_MODEL,
    MODEL_CONTEXT_WINDOW_TOKENS: overrides.MODEL_CONTEXT_WINDOW_TOKENS ?? process.env.MODEL_CONTEXT_WINDOW_TOKENS,
    MODEL_AUTO_COMPACT_TOKEN_LIMIT: overrides.MODEL_AUTO_COMPACT_TOKEN_LIMIT ?? process.env.MODEL_AUTO_COMPACT_TOKEN_LIMIT,
    WEB_SEARCH_MODE: overrides.WEB_SEARCH_MODE ?? process.env.WEB_SEARCH_MODE,
    OPENAI_REASONING_EFFORT: overrides.OPENAI_REASONING_EFFORT ?? process.env.OPENAI_REASONING_EFFORT,
  });

  const dataRoot = path.resolve(cwd, raw.DATA_ROOT);
  const skillsRoot = path.resolve(cwd, raw.SKILLS_ROOT);

  return {
    ...raw,
    CWD: cwd,
    DATA_ROOT: dataRoot,
    SKILLS_ROOT: skillsRoot,
    DB_PATH: path.join(dataRoot, 'skillchat.sqlite'),
    INLINE_JOBS: overrides.INLINE_JOBS ?? false,
  };
};
