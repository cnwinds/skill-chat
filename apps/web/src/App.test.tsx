import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { FileEvent, TextMessageEvent, ThinkingEvent, ToolProgressEvent } from '@skillchat/shared';
import { MessageItem } from './components/MessageItem';
import { QuestionTimelineControl } from './components/chat/QuestionTimelineControl';
import type { ToolTraceDisplayEvent, ToolTraceGroupDisplayEvent } from './lib/timeline';

describe('MessageItem', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('renders a text message', () => {
    const event: TextMessageEvent = {
      id: 'evt_1',
      sessionId: 's1',
      kind: 'message',
      role: 'assistant',
      type: 'text',
      content: '你好，SkillChat',
      createdAt: new Date().toISOString(),
    };

    render(<MessageItem event={event} />);
    expect(screen.getByText('你好，SkillChat')).toBeInTheDocument();
  });

  it('renders markdown tables inside assistant messages', () => {
    const event: TextMessageEvent = {
      id: 'evt_table_1',
      sessionId: 's1',
      kind: 'message',
      role: 'assistant',
      type: 'text',
      content: [
        '| 专业 | 城市 |',
        '| --- | --- |',
        '| 计算机 | 上海 |',
        '| 金融 | 深圳 |',
      ].join('\n'),
      createdAt: new Date().toISOString(),
    };

    render(<MessageItem event={event} />);

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '专业' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '城市' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '计算机' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '深圳' })).toBeInTheDocument();
  });

  it('renders assistant token usage and duration metadata under the reply', () => {
    const event: TextMessageEvent = {
      id: 'evt_meta_1',
      sessionId: 's1',
      kind: 'message',
      role: 'assistant',
      type: 'text',
      content: '这里是最终建议。',
      createdAt: new Date().toISOString(),
      meta: {
        durationMs: 4200,
        tokenUsage: {
          inputTokens: 120,
          outputTokens: 45,
          totalTokens: 165,
        },
      },
    };

    render(<MessageItem event={event} />);
    expect(screen.getByText('165 (120/45) tokens · 4.2s')).toBeInTheDocument();
  });

  it('renders reasoning summary for pending assistant output', () => {
    render(
      <MessageItem
        event={{ kind: 'pending_text', content: '先给你结论。' }}
        assistantMeta={{
          reasoningSummary: '先看分数线，再看就业密度。',
          tokenUsage: {
            inputTokens: 120,
            outputTokens: 30,
            totalTokens: 150,
          },
        }}
      />,
    );

    expect(screen.getByText('推理摘要')).toBeInTheDocument();
    expect(screen.getByText('先看分数线，再看就业密度。')).toBeInTheDocument();
    expect(screen.getByText('150 (120/30) tokens')).toBeInTheDocument();
  });

  it('copies message content from the hover action button', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText,
      },
    });

    const event: TextMessageEvent = {
      id: 'evt_copy_1',
      sessionId: 's1',
      kind: 'message',
      role: 'assistant',
      type: 'text',
      content: '请复制这段回复',
      createdAt: new Date().toISOString(),
    };

    render(<MessageItem event={event} />);
    fireEvent.click(screen.getByRole('button', { name: '复制消息内容' }));

    expect(writeText).toHaveBeenCalledWith('请复制这段回复');
    expect(await screen.findByText('已复制')).toBeInTheDocument();
  });

  it('renders tool progress and file card', () => {
    const progress: ToolProgressEvent = {
      id: 'evt_2',
      sessionId: 's1',
      kind: 'tool_progress',
      skill: 'pdf',
      message: '正在生成 PDF',
      percent: 70,
      createdAt: new Date().toISOString(),
    };

    const fileEvent: FileEvent = {
      id: 'evt_3',
      sessionId: 's1',
      kind: 'file',
      file: {
        id: 'f1',
        userId: 'u1',
        sessionId: 's1',
        displayName: 'report.pdf',
        relativePath: 'sessions/s1/outputs/report.pdf',
        mimeType: 'application/pdf',
        size: 1024,
        bucket: 'outputs',
        source: 'generated',
        createdAt: new Date().toISOString(),
      },
      createdAt: new Date().toISOString(),
    };

    const { rerender } = render(<MessageItem event={progress} />);
    expect(screen.getByText('正在生成 PDF')).toBeInTheDocument();

    rerender(<MessageItem event={fileEvent} />);
    expect(screen.getByText('report.pdf')).toBeInTheDocument();
  });

  it('renders thinking as a single-line elapsed timer bubble', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-11T12:00:40.000Z'));

    const event: ThinkingEvent = {
      id: 'evt_4',
      sessionId: 's1',
      kind: 'thinking',
      content: '正在分析需求',
      createdAt: '2026-04-11T12:00:00.000Z',
    };

    render(<MessageItem event={event} />);
    expect(screen.getByText('思考中(40秒)')).toBeInTheDocument();
  });

  it('renders thinking duration in minutes after 60 seconds', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-11T12:02:05.000Z'));

    const event: ThinkingEvent = {
      id: 'evt_5',
      sessionId: 's1',
      kind: 'thinking',
      content: '正在分析需求',
      createdAt: '2026-04-11T12:00:00.000Z',
    };

    render(<MessageItem event={event} />);
    expect(screen.getByText('思考中(2分钟5秒)')).toBeInTheDocument();
  });

  it('renders reconnect progress in the thinking bubble when reconnecting', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-11T12:00:12.000Z'));

    const event: ThinkingEvent = {
      id: 'evt_6',
      sessionId: 's1',
      kind: 'thinking',
      content: '重连中1/5',
      createdAt: '2026-04-11T12:00:00.000Z',
    };

    render(<MessageItem event={event} />);
    expect(screen.getByText('重连中1/5(12秒)')).toBeInTheDocument();
  });

  it('renders a compact collapsed tool trace card', () => {
    const event: ToolTraceDisplayEvent = {
      id: 'tool_1',
      kind: 'tool_trace',
      sessionId: 's1',
      createdAt: new Date().toISOString(),
      tool: 'web_search',
      arguments: { query: '金融专业就业' },
      message: '检索到 3 条网页结果',
      resultContent: '1. Example News\nURL: https://example.com/news',
      status: 'success',
    };

    render(<MessageItem event={event} />);
    expect(screen.getByText('搜索页面')).toBeInTheDocument();
    expect(screen.getByText('已完成')).toBeInTheDocument();
    expect(screen.getByText('检索到 3 条网页结果')).toBeInTheDocument();
    expect(screen.getByText('返回结果')).toBeInTheDocument();
    expect(screen.getByText(/Example News/)).toBeInTheDocument();
  });

  it('renders tool trace as non-expandable summary for non-admin users', () => {
    const event: ToolTraceDisplayEvent = {
      id: 'tool_1',
      kind: 'tool_trace',
      sessionId: 's1',
      createdAt: new Date().toISOString(),
      tool: 'web_search',
      arguments: { query: '金融专业就业' },
      message: '检索到 3 条网页结果',
      resultContent: '1. Example News\nURL: https://example.com/news',
      status: 'success',
    };

    const { container } = render(<MessageItem event={event} canExpandToolTrace={false} />);
    expect(within(container).getByText('搜索页面')).toBeInTheDocument();
    expect(within(container).getByText('检索到 3 条网页结果')).toBeInTheDocument();
    expect(container.querySelector('details')).toBeNull();
    expect(within(container).queryByText('返回结果')).not.toBeInTheDocument();
  });

  it('renders skill file reads with friendlier labels', () => {
    const event: ToolTraceDisplayEvent = {
      id: 'tool_2',
      kind: 'tool_trace',
      sessionId: 's1',
      createdAt: new Date().toISOString(),
      tool: 'read_workspace_path_slice',
      arguments: { root: 'workspace', path: 'skills/zhangxuefeng-perspective/SKILL.md' },
      message: '已读取 当前工作区 / skills/zhangxuefeng-perspective/SKILL.md',
      resultContent: '# Guide\n\nLine 2',
      status: 'success',
    };

    render(<MessageItem event={event} />);
    expect(screen.getByText('读取 Skill')).toBeInTheDocument();
    expect(screen.getByText('已读取 Skill 定义：zhangxuefeng-perspective / SKILL.md')).toBeInTheDocument();
    expect(screen.getAllByText(/zhangxuefeng-perspective \/ SKILL.md/)).toHaveLength(2);
    expect(screen.getByText(/Line 2/)).toBeInTheDocument();
  });

  it('renders skill reference reads with friendlier labels', () => {
    const event: ToolTraceDisplayEvent = {
      id: 'tool_3',
      kind: 'tool_trace',
      sessionId: 's1',
      createdAt: new Date().toISOString(),
      tool: 'read_workspace_path_slice',
      arguments: { root: 'workspace', path: 'skills/zhangxuefeng-perspective/references/majors.md' },
      message: '已读取 当前工作区 / skills/zhangxuefeng-perspective/references/majors.md',
      resultContent: '人工智能、口腔医学、临床医学',
      status: 'success',
    };

    render(<MessageItem event={event} />);
    expect(screen.getByText('读取参考资料')).toBeInTheDocument();
    expect(screen.getByText('已读取参考资料：zhangxuefeng-perspective / references/majors.md')).toBeInTheDocument();
    expect(screen.getAllByText(/zhangxuefeng-perspective \/ references\/majors.md/)).toHaveLength(2);
    expect(screen.getByText(/人工智能、口腔医学、临床医学/)).toBeInTheDocument();
  });

  it('renders consecutive tool traces as a collapsed group', () => {
    const group: ToolTraceGroupDisplayEvent = {
      id: 'tool_2-group',
      kind: 'tool_trace_group',
      sessionId: 's1',
      createdAt: new Date().toISOString(),
      groupKey: 'read_workspace_path_slice:skill',
      tool: 'read_workspace_path_slice',
      status: 'success',
      items: [
        {
          id: 'tool_2',
          kind: 'tool_trace',
          sessionId: 's1',
          createdAt: new Date().toISOString(),
          tool: 'read_workspace_path_slice',
          arguments: { root: 'workspace', path: 'skills/zhangxuefeng-perspective/SKILL.md' },
          message: '已读取 当前工作区 / skills/zhangxuefeng-perspective/SKILL.md',
          resultContent: '# Skill',
          status: 'success',
        },
        {
          id: 'tool_3',
          kind: 'tool_trace',
          sessionId: 's1',
          createdAt: new Date().toISOString(),
          tool: 'read_workspace_path_slice',
          arguments: { root: 'workspace', path: 'skills/another-perspective/SKILL.md' },
          message: '已读取 当前工作区 / skills/another-perspective/SKILL.md',
          resultContent: '# Another',
          status: 'success',
        },
      ],
    };

    render(<MessageItem event={group} />);
    expect(screen.getByText('读取 Skill x 2')).toBeInTheDocument();
    expect(screen.getByText('最近：已读取 Skill 定义：another-perspective / SKILL.md')).toBeInTheDocument();
    expect(screen.getByText('第 1 次')).toBeInTheDocument();
    expect(screen.getByText('第 2 次')).toBeInTheDocument();
  });
});

describe('QuestionTimelineControl', () => {
  afterEach(() => {
    cleanup();
  });

  it('opens a searchable question timeline and selects a question', () => {
    const onSelectQuestion = vi.fn();
    render(
      <div className="relative h-96">
        <QuestionTimelineControl
          questions={[
            {
              id: 'q1',
              index: 1,
              content: '我应该怎么选择专业？',
              createdAt: '2026-04-26T10:00:00.000Z',
            },
            {
              id: 'q2',
              index: 2,
              content: '法学和师范类哪个更适合普通家庭？',
              createdAt: '2026-04-26T10:05:00.000Z',
            },
          ]}
          activeQuestionId={null}
          onSelectQuestion={onSelectQuestion}
        />
      </div>,
    );

    const toggle = screen.getByRole('button', { name: '切换问题定位列表，共 2 个提问' });
    expect(toggle).toHaveTextContent('2');
    expect(toggle).not.toHaveTextContent('问题');

    // Closed state: panel is mounted (so the open transition can interpolate
    // smoothly) but inert + aria-hidden so users can't reach it. Note we can't
    // assert visual hiding via `toBeVisible()` here because jsdom doesn't apply
    // the Tailwind utility classes that drive the visual transition.
    const panel = screen.getByLabelText('问题定位列表，共 2 个提问');
    expect(panel).toHaveAttribute('aria-hidden', 'true');
    expect(panel).toHaveAttribute('inert');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);
    // The same button stays in place when open — it is the visual handle of
    // the merged panel, just the panel content (search box) is now interactive.
    expect(
      screen.getByRole('button', { name: '切换问题定位列表，共 2 个提问' }),
    ).toBe(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(panel).toHaveAttribute('aria-hidden', 'false');
    expect(panel).not.toHaveAttribute('inert');

    fireEvent.change(screen.getByPlaceholderText('搜索提问内容'), {
      target: { value: '法学' },
    });
    expect(screen.queryByText('我应该怎么选择专业？')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /法学和师范类/ }));
    expect(onSelectQuestion).toHaveBeenCalledWith('q2');

    fireEvent.click(toggle);
    // Re-closed: panel returns to inert + aria-hidden state.
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(panel).toHaveAttribute('aria-hidden', 'true');
    expect(panel).toHaveAttribute('inert');
  });
});
