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
  SESSION_EXPIRES_IN: '7d',
  OPENAI_BASE_URL: 'http://example.com/v1',
  OPENAI_API_KEY: 'test-token',
  OPENAI_MODEL: 'gpt-5.4',
  WEB_SEARCH_MODE: 'live',
  OPENAI_REASONING_EFFORT: 'xhigh',
  LLM_MAX_OUTPUT_TOKENS: 4096,
  TOOL_MAX_OUTPUT_TOKENS: 3072,
  ENABLE_ASSISTANT_TOOLS: true,
  LLM_REQUEST_TIMEOUT_MS: 1_000,
  STREAM_MAX_RETRIES: 5,
  STREAM_BACKOFF_BASE_MS: 1_000,
  STREAM_BACKOFF_MULTIPLIER: 2,
  ENABLE_TOKEN_TRACKING: true,
  ENABLE_REASONING_EVENTS: false,
  MAX_CONCURRENT_RUNS: 5,
  RUN_TIMEOUT_MS: 120_000,
});

describe('buildOpenAIHarnessInstructions', () => {
  it('aligns skill guidance to the codex-style progressive disclosure rules', () => {
    const instructions = buildOpenAIHarnessInstructions({
      config: createConfig(),
      files: [],
      availableSkills: [{
        name: 'zhangxuefeng-perspective',
        description: '以张雪峰风格给出专业和志愿建议。',
        directory: '/workspace/qizhi/skills/zhangxuefeng-perspective',
        markdown: '# 张雪峰风格',
        starterPrompts: ['扮演张雪峰'],
      }],
    });

    expect(instructions).toContain('以下列表是当前会话唯一可用的 skill');
    expect(instructions).toContain('Discovery: 上面的列表就是当前会话已启用的全部 skills');
    expect(instructions).toContain('Scope: 只有上面列出的 skill 可以被读取、参考或使用其目录中的脚本');
    expect(instructions).toContain('Trigger rules: 如果用户点名某个已启用 skill');
    expect(instructions).toContain('How to use a skill (progressive disclosure):');
    expect(instructions).toContain('只读取当前请求需要的具体文件，不要整包加载');
    expect(instructions).toContain('run_workspace_script');
    expect(instructions).toContain('按原生命令行运行');
    expect(instructions).toContain('不要假设存在默认 `run.py` 入口');
    expect(instructions).toContain('Context hygiene: 保持上下文精简');
    expect(instructions).toContain('Skill 是本地说明书，不是特殊流程节点');
    expect(instructions).toContain('是否调用、调用顺序和调用次数由你自行判断');
    expect(instructions).not.toContain('需要最新事实、新闻、政策、排名、就业数据、薪资数据或官网信息时，优先使用 `web_search`。');
    expect(instructions).not.toContain('用户给出明确网页 URL，或你需要抓取一个确定页面时，再使用 `web_fetch`。');
    expect(instructions).not.toContain('访问项目文件、配置或脚本时，优先 `list_workspace_paths` / `read_workspace_path_slice`');
    expect(instructions).not.toContain('需要读取文件内容时，优先 `list_files` / `read_file`');
  });
});
