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
  DEFAULT_SESSION_ACTIVE_SKILLS: z.preprocess((value) => {
    if (Array.isArray(value)) {
      return value;
    }
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return [];
  }, z.array(z.string())).default([]),
  OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  OPENAI_API_KEY: z.string().optional().default(''),
  OPENAI_MODEL_ROUTER: z.string().default('gpt-4o-mini'),
  OPENAI_MODEL_PLANNER: z.string().default('gpt-4o-mini'),
  OPENAI_MODEL_REPLY: z.string().default('gpt-5.4'),
  OPENAI_REASONING_EFFORT_REPLY: z.enum(['minimal', 'low', 'medium', 'high', 'xhigh']).default('xhigh'),
  LLM_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(10240),
  TOOL_MAX_OUTPUT_TOKENS: z.coerce.number().int().positive().default(4096),
  ANTHROPIC_BASE_URL: z.string().url().default('https://api.anthropic.com'),
  ANTHROPIC_AUTH_TOKEN: z.string().optional().default(''),
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  ANTHROPIC_MODEL_ROUTER: z.string().default('claude-sonnet-4-5'),
  ANTHROPIC_MODEL_PLANNER: z.string().default('claude-sonnet-4-5'),
  ANTHROPIC_MODEL_REPLY: z.string().default('claude-sonnet-4-5'),
  ENABLE_ASSISTANT_TOOLS: z.coerce.boolean().default(true),
  LLM_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(45000),
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
