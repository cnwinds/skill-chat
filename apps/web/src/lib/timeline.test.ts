import { describe, expect, it } from 'vitest';
import type { StoredEvent } from '@skillchat/shared';
import { buildRenderableTimeline, buildTimelineItems } from './timeline';

describe('buildTimelineItems', () => {
  it('merges a single tool call flow into one compact timeline item', () => {
    const events: StoredEvent[] = [
      {
        id: 'call',
        sessionId: 's1',
        kind: 'tool_call',
        callId: 'tool_1',
        skill: 'web_search',
        arguments: { query: '金融专业就业' },
        createdAt: '2026-04-09T13:00:00.000Z',
      },
      {
        id: 'progress',
        sessionId: 's1',
        kind: 'tool_progress',
        callId: 'tool_1',
        skill: 'web_search',
        message: '开始调用工具',
        status: 'running',
        createdAt: '2026-04-09T13:00:01.000Z',
      },
      {
        id: 'result',
        sessionId: 's1',
        kind: 'tool_result',
        callId: 'tool_1',
        skill: 'web_search',
        message: '检索到 3 条网页结果',
        createdAt: '2026-04-09T13:00:02.000Z',
      },
    ];

    const timeline = buildTimelineItems(events);

    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({
      kind: 'tool_trace',
      tool: 'web_search',
      message: '检索到 3 条网页结果',
      status: 'success',
    });
  });

  it('keeps workspace read tools in the same compact trace model', () => {
    const events: StoredEvent[] = [
      {
        id: 'call',
        sessionId: 's1',
        kind: 'tool_call',
        callId: 'tool_2',
        skill: 'read_workspace_path_slice',
        arguments: { root: 'workspace', path: 'docs/guide.md' },
        createdAt: '2026-04-10T10:00:00.000Z',
      },
      {
        id: 'result',
        sessionId: 's1',
        kind: 'tool_result',
        callId: 'tool_2',
        skill: 'read_workspace_path_slice',
        message: '已读取 当前工作区 / docs/guide.md',
        content: '# Guide',
        createdAt: '2026-04-10T10:00:01.000Z',
      },
    ];

    const timeline = buildTimelineItems(events);

    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({
      kind: 'tool_trace',
      tool: 'read_workspace_path_slice',
      message: '已读取 当前工作区 / docs/guide.md',
      resultContent: '# Guide',
      status: 'success',
    });
  });

  it('skips hidden tool events so invalid provider payloads are not displayed', () => {
    const events: StoredEvent[] = [
      {
        id: 'hidden-call',
        sessionId: 's1',
        kind: 'tool_call',
        callId: 'tool_hidden',
        skill: 'web_search',
        arguments: {},
        createdAt: '2026-04-10T10:00:00.000Z',
      },
      {
        id: 'hidden-progress',
        sessionId: 's1',
        kind: 'tool_progress',
        callId: 'tool_hidden',
        skill: 'web_search',
        message: 'provider 正在联网搜索',
        status: 'running',
        createdAt: '2026-04-10T10:00:01.000Z',
      },
      {
        id: 'hidden-result',
        sessionId: 's1',
        kind: 'tool_result',
        callId: 'tool_hidden',
        skill: 'web_search',
        message: '已忽略缺少 URL 的 open_page',
        content: '{"type":"open_page"}',
        hidden: true,
        createdAt: '2026-04-10T10:00:02.000Z',
      },
      {
        id: 'visible-result',
        sessionId: 's1',
        kind: 'tool_result',
        callId: 'tool_visible',
        skill: 'web_search',
        message: 'Search: 金融专业就业',
        createdAt: '2026-04-10T10:00:03.000Z',
      },
    ];

    const timeline = buildTimelineItems(events);

    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({
      kind: 'tool_trace',
      tool: 'web_search',
      message: 'Search: 金融专业就业',
    });
  });

  it('keeps thinking out of the main timeline and exposes the latest thinking event separately', () => {
    const events: StoredEvent[] = [
      {
        id: 'thinking_1',
        sessionId: 's1',
        kind: 'thinking',
        content: '正在分析需求',
        createdAt: '2026-04-11T12:00:00.000Z',
      },
      {
        id: 'call',
        sessionId: 's1',
        kind: 'tool_call',
        callId: 'tool_3',
        skill: 'web_search',
        arguments: { query: '上海 选科' },
        createdAt: '2026-04-11T12:00:01.000Z',
      },
      {
        id: 'thinking_2',
        sessionId: 's1',
        kind: 'thinking',
        content: '正在整理结论',
        createdAt: '2026-04-11T12:00:02.000Z',
      },
    ];

    const timeline = buildRenderableTimeline(events);

    expect(timeline.items).toHaveLength(1);
    expect(timeline.items[0]).toMatchObject({
      kind: 'tool_trace',
      tool: 'web_search',
    });
    expect(timeline.activeThinking).toMatchObject({
      id: 'thinking_2',
      content: '正在整理结论',
    });
  });
});
