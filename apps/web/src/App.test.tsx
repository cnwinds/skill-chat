import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { FileEvent, TextMessageEvent, ThinkingEvent, ToolProgressEvent } from '@skillchat/shared';
import { MessageItem } from './components/MessageItem';
import type { ToolTraceDisplayEvent } from './lib/timeline';

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
    expect(screen.getByText('正在思考(40秒)')).toBeInTheDocument();
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
    expect(screen.getByText('正在思考(2分钟5秒)')).toBeInTheDocument();
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
    expect(screen.getByText('web_search')).toBeInTheDocument();
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
    expect(within(container).getByText('web_search')).toBeInTheDocument();
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
});
