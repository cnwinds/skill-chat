import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../config/env.js';
import { buildOpenAIHarnessInstructions } from './openai-harness-prompt.js';

const createConfig = (): AppConfig => ({
  NODE_ENV: 'test',
  PORT: 3000,
  WEB_ORIGIN: 'http://localhost:5173',
  DATA_ROOT: '/tmp/skillchat-data',
  SKILLS_ROOT: '/tmp/skillchat-data/skills',
  DB_PATH: '/tmp/skillchat-data/skillchat.sqlite',
  CWD: '/workspace/qizhi',
  INLINE_JOBS: true,
  JWT_SECRET: 'test-secret',
  JWT_EXPIRES_IN: '7d',
  OPENAI_BASE_URL: 'http://example.com/v1',
  OPENAI_API_KEY: 'test-token',
  OPENAI_MODEL_ROUTER: 'gpt-4o-mini',
  OPENAI_MODEL_PLANNER: 'gpt-4o-mini',
  OPENAI_MODEL_REPLY: 'gpt-5.4',
  OPENAI_REASONING_EFFORT_REPLY: 'xhigh',
  LLM_MAX_OUTPUT_TOKENS: 4096,
  TOOL_MAX_OUTPUT_TOKENS: 3072,
  ANTHROPIC_BASE_URL: 'http://example.com',
  ANTHROPIC_AUTH_TOKEN: '',
  ANTHROPIC_API_KEY: '',
  ANTHROPIC_MODEL_ROUTER: 'claude-sonnet-4-5',
  ANTHROPIC_MODEL_PLANNER: 'claude-sonnet-4-5',
  ANTHROPIC_MODEL_REPLY: 'claude-sonnet-4-5',
  DEFAULT_SESSION_ACTIVE_SKILLS: [],
  ENABLE_ASSISTANT_TOOLS: true,
  LLM_REQUEST_TIMEOUT_MS: 1_000,
  MAX_CONCURRENT_RUNS: 5,
  RUN_TIMEOUT_MS: 120_000,
  USER_STORAGE_QUOTA_MB: 1024,
});

describe('buildOpenAIHarnessInstructions', () => {
  it('aligns skill guidance to the codex-style progressive disclosure rules', () => {
    const instructions = buildOpenAIHarnessInstructions({
      config: createConfig(),
      files: [],
      skills: [{
        name: 'zhangxuefeng-perspective',
        description: '以张雪峰风格给出专业和志愿建议。',
        entrypoint: '',
        runtime: 'chat',
        timeoutSec: 120,
        references: ['style-guide.md', 'core-framework.md', 'boundaries-and-sources.md'],
        directory: '/workspace/qizhi/skills/zhangxuefeng-perspective',
        markdown: '# 张雪峰风格',
        referencesContent: [],
      }],
    });

    expect(instructions).toContain('Discovery: 上面的列表就是当前会话可用的 skills');
    expect(instructions).toContain('Trigger rules: 如果用户点名某个 skill');
    expect(instructions).toContain('How to use a skill (progressive disclosure):');
    expect(instructions).toContain('只读取当前请求需要的具体文件，不要整包加载');
    expect(instructions).toContain('Context hygiene: 保持上下文精简');
  });
});
