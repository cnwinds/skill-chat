import { describe, expect, it } from 'vitest';
import {
  buildDynamicFileSection,
  buildResponsesHistoryInput,
  shouldAutoCompactHistory,
} from './openai-harness-context.js';

const getMessageText = (content: string | Array<{ type: string; text?: string }>) => (
  typeof content === 'string'
    ? content
    : content
      .map((item) => item.text ?? '')
      .filter(Boolean)
      .join('\n')
);

describe('openai-harness-context', () => {
  it('does not cap history to the latest 16 messages when budget allows', () => {
    const history = Array.from({ length: 20 }, (_, index) => ({
      id: `evt_${index}`,
      sessionId: 's1',
      kind: 'message' as const,
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      type: 'text' as const,
      content: `短消息 ${index + 1}`,
      createdAt: `2026-04-13T10:00:${String(index).padStart(2, '0')}.000Z`,
    }));

    const result = buildResponsesHistoryInput({
      history,
      currentMessage: '继续',
      maxTokens: 2_000,
    });

    expect(result.input.length).toBeGreaterThan(16);
    expect(result.didTruncateToBudget).toBe(false);
  });

  it('uses the latest compaction summary as baseline and only keeps delta after it', () => {
    const history = [
      {
        id: 'evt_old_user',
        sessionId: 's1',
        kind: 'message' as const,
        role: 'user' as const,
        type: 'text' as const,
        content: '旧问题：先看专业选择',
        createdAt: '2026-04-13T09:59:00.000Z',
      },
      {
        id: 'evt_old_assistant',
        sessionId: 's1',
        kind: 'message' as const,
        role: 'assistant' as const,
        type: 'text' as const,
        content: '旧回答：先看就业',
        createdAt: '2026-04-13T09:59:01.000Z',
      },
      {
        id: 'evt_new_tool',
        sessionId: 's1',
        kind: 'tool_result' as const,
        skill: 'web_search',
        message: '已搜索到最新就业数据',
        content: '人工智能和电气工程近年需求都有，但城市差异明显。',
        createdAt: '2026-04-13T10:00:00.000Z',
      },
      {
        id: 'evt_new_user',
        sessionId: 's1',
        kind: 'message' as const,
        role: 'user' as const,
        type: 'text' as const,
        content: '继续，把杭州也加进来',
        createdAt: '2026-04-13T10:00:01.000Z',
      },
    ];

    const result = buildResponsesHistoryInput({
      history,
      currentMessage: '继续，把杭州也加进来',
      contextState: {
        version: 1,
        latestCompaction: {
          summary: '摘要：用户之前主要比较专业就业和城市。',
          createdAt: '2026-04-13T09:59:30.000Z',
          baselineCreatedAt: '2026-04-13T09:59:01.000Z',
          trigger: 'manual',
        },
      },
      maxTokens: 2_000,
    });

    expect(getMessageText(result.input[0]?.content ?? '')).toContain('会话压缩摘要');
    expect(getMessageText(result.input[0]?.content ?? '')).toContain('用户之前主要比较专业就业和城市');
    expect(result.input.some((item) => getMessageText(item.content).includes('旧问题'))).toBe(false);
    expect(result.input.some((item) => getMessageText(item.content).includes('已搜索到最新就业数据'))).toBe(true);
    expect(result.input.some((item) => getMessageText(item.content).includes('继续，把杭州也加进来'))).toBe(true);
  });

  it('triggers auto compact when history exceeds the configured token limit', () => {
    const result = buildResponsesHistoryInput({
      config: {
        LLM_MAX_OUTPUT_TOKENS: 4096,
        MODEL_CONTEXT_WINDOW_TOKENS: 16_000,
        MODEL_AUTO_COMPACT_TOKEN_LIMIT: 60,
      },
      history: [
        {
          id: 'evt_1',
          sessionId: 's1',
          kind: 'message' as const,
          role: 'user' as const,
          type: 'text' as const,
          content: '这是一段很长很长的历史消息，用来触发自动上下文压缩。'.repeat(20),
          createdAt: '2026-04-13T10:00:00.000Z',
        },
      ],
      currentMessage: '继续',
      maxTokens: 500,
    });

    expect(shouldAutoCompactHistory({
      config: {
        LLM_MAX_OUTPUT_TOKENS: 4096,
        MODEL_CONTEXT_WINDOW_TOKENS: 16_000,
        MODEL_AUTO_COMPACT_TOKEN_LIMIT: 60,
      },
      buildResult: result,
    })).toBe(true);
  });

  it('builds session file preview by budget instead of a fixed file count', () => {
    const section = buildDynamicFileSection(
      Array.from({ length: 12 }, (_, index) => ({
        id: `file_${index + 1}`,
        name: `file-${index + 1}.txt`,
        bucket: 'uploads',
        size: 128,
        relativePath: `sessions/s1/uploads/file-${index + 1}.txt`,
      })),
      (relativePath) => relativePath.replace(/^sessions\/[^/]+\//, ''),
    );

    expect(section).toContain('file-1.txt');
    expect(section).toContain('file-9.txt');
  });

  it('can inject compaction summary before the last user message for mid-turn continuation', () => {
    const result = buildResponsesHistoryInput({
      history: [
        {
          id: 'evt_1',
          sessionId: 's1',
          kind: 'message' as const,
          role: 'assistant' as const,
          type: 'text' as const,
          content: '前文答到一半',
          createdAt: '2026-04-13T10:00:00.000Z',
        },
        {
          id: 'evt_2',
          sessionId: 's1',
          kind: 'message' as const,
          role: 'user' as const,
          type: 'text' as const,
          content: '继续，并补充杭州数据',
          createdAt: '2026-04-13T10:00:01.000Z',
        },
      ],
      contextState: {
        version: 1,
        latestCompaction: {
          summary: '摘要：用户正在比较城市与专业。',
          createdAt: '2026-04-13T10:00:02.000Z',
          baselineCreatedAt: null,
          trigger: 'auto',
        },
      },
      injectionStrategy: 'before_last_user',
    });

    expect(getMessageText(result.input[0]?.content ?? '')).toContain('前文答到一半');
    expect(getMessageText(result.input[1]?.content ?? '')).toContain('会话压缩摘要');
    expect(getMessageText(result.input[2]?.content ?? '')).toContain('继续，并补充杭州数据');
  });
});
