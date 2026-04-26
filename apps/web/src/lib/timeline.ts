import type { StoredEvent, ThinkingEvent } from '@skillchat/shared';

type ToolTraceStatus = 'queued' | 'running' | 'success' | 'failed';

export type ToolTraceDisplayEvent = {
  id: string;
  kind: 'tool_trace';
  sessionId: string;
  createdAt: string;
  tool: string;
  callId?: string;
  arguments?: Record<string, unknown>;
  message: string;
  resultContent?: string;
  status: ToolTraceStatus;
  percent?: number;
  meta?: Record<string, unknown>;
};

export type ToolTraceGroupDisplayEvent = {
  id: string;
  kind: 'tool_trace_group';
  sessionId: string;
  createdAt: string;
  groupKey: string;
  tool: string;
  status: ToolTraceStatus;
  items: ToolTraceDisplayEvent[];
};

export type TimelineItem = StoredEvent | ToolTraceDisplayEvent | ToolTraceGroupDisplayEvent;

export type RenderableTimeline = {
  items: TimelineItem[];
  activeThinking?: ThinkingEvent;
};

const normalizeToolStatus = (status?: string): ToolTraceDisplayEvent['status'] => {
  if (status === 'queued') {
    return 'queued';
  }
  if (status === 'failed') {
    return 'failed';
  }
  if (status === 'success') {
    return 'success';
  }
  return 'running';
};

const isToolEvent = (event: StoredEvent): event is Extract<StoredEvent, { kind: 'tool_call' | 'tool_progress' | 'tool_result' }> =>
  event.kind === 'tool_call' || event.kind === 'tool_progress' || event.kind === 'tool_result';

const isHiddenToolEvent = (event: Extract<StoredEvent, { kind: 'tool_call' | 'tool_progress' | 'tool_result' }>) =>
  event.hidden === true;

const isThinkingEvent = (event: StoredEvent): event is ThinkingEvent => event.kind === 'thinking';

const getWorkspaceReadCategory = (trace: ToolTraceDisplayEvent) => {
  const path = typeof trace.arguments?.path === 'string' ? trace.arguments.path.replace(/\\/g, '/') : '';
  if (/(^|\/)SKILL\.md$/i.test(path)) {
    return 'skill';
  }
  if (/(^|\/)references\//i.test(path)) {
    return 'reference';
  }
  return 'workspace';
};

const getToolTraceGroupKey = (trace: ToolTraceDisplayEvent) => {
  if (trace.tool === 'read_workspace_path_slice') {
    return `${trace.tool}:${getWorkspaceReadCategory(trace)}`;
  }
  return trace.tool;
};

const aggregateToolStatus = (items: ToolTraceDisplayEvent[]): ToolTraceStatus => {
  if (items.some((item) => item.status === 'failed')) {
    return 'failed';
  }
  if (items.some((item) => item.status === 'running')) {
    return 'running';
  }
  if (items.every((item) => item.status === 'queued')) {
    return 'queued';
  }
  return 'success';
};

const createToolTraceGroup = (
  groupKey: string,
  items: ToolTraceDisplayEvent[],
): ToolTraceGroupDisplayEvent => {
  const firstItem = items[0]!;
  return {
    id: `${firstItem.id}-group`,
    kind: 'tool_trace_group',
    sessionId: firstItem.sessionId,
    createdAt: firstItem.createdAt,
    groupKey,
    tool: firstItem.tool,
    status: aggregateToolStatus(items),
    items,
  };
};

const compactConsecutiveToolTraces = (items: TimelineItem[]): TimelineItem[] => {
  const compacted: TimelineItem[] = [];
  let currentGroupKey: string | null = null;
  let currentGroup: ToolTraceDisplayEvent[] = [];

  const flushGroup = () => {
    if (currentGroup.length === 1) {
      compacted.push(currentGroup[0]!);
    } else if (currentGroup.length > 1 && currentGroupKey) {
      compacted.push(createToolTraceGroup(currentGroupKey, currentGroup));
    }
    currentGroupKey = null;
    currentGroup = [];
  };

  for (const item of items) {
    if (item.kind !== 'tool_trace') {
      flushGroup();
      compacted.push(item);
      continue;
    }

    const groupKey = getToolTraceGroupKey(item);
    if (currentGroupKey && currentGroupKey !== groupKey) {
      flushGroup();
    }

    currentGroupKey = groupKey;
    currentGroup.push(item);
  }

  flushGroup();
  return compacted;
};

export const buildTimelineItems = (events: StoredEvent[]): TimelineItem[] => {
  const items: TimelineItem[] = [];
  const toolIndexByCallId = new Map<string, number>();
  const hiddenCallIds = new Set(
    events
      .filter(isToolEvent)
      .filter((event) => event.hidden === true && typeof event.callId === 'string' && event.callId.length > 0)
      .map((event) => event.callId as string),
  );

  const upsertToolTrace = (
    event: Extract<StoredEvent, { kind: 'tool_call' | 'tool_progress' | 'tool_result' }>,
    updater: (current: ToolTraceDisplayEvent | undefined) => ToolTraceDisplayEvent,
  ) => {
    const lastItem = items.at(-1);
    const existingIndex = event.callId
      ? toolIndexByCallId.get(event.callId)
      : (lastItem?.kind === 'tool_trace' && lastItem.tool === event.skill ? items.length - 1 : undefined);

    if (typeof existingIndex === 'number') {
      const current = items[existingIndex] as ToolTraceDisplayEvent;
      items[existingIndex] = updater(current);
      return;
    }

    const next = updater(undefined);
    items.push(next);
    if (event.callId) {
      toolIndexByCallId.set(event.callId, items.length - 1);
    }
  };

  for (const event of events) {
    if (!isToolEvent(event)) {
      items.push(event);
      continue;
    }

    if (isHiddenToolEvent(event)) {
      continue;
    }

    if (event.callId && hiddenCallIds.has(event.callId)) {
      continue;
    }

    if (event.kind === 'tool_call') {
      upsertToolTrace(event, (current) => ({
        id: current?.id ?? event.callId ?? event.id,
        kind: 'tool_trace',
        sessionId: event.sessionId,
        createdAt: current?.createdAt ?? event.createdAt,
        tool: event.skill,
        callId: event.callId,
        arguments: event.arguments,
        message: current?.message ?? '开始调用工具',
        resultContent: current?.resultContent,
        status: current?.status ?? 'running',
        percent: current?.percent,
        meta: current?.meta ?? event.meta,
      }));
      continue;
    }

    if (event.kind === 'tool_progress') {
      upsertToolTrace(event, (current) => ({
        id: current?.id ?? event.callId ?? event.id,
        kind: 'tool_trace',
        sessionId: event.sessionId,
        createdAt: current?.createdAt ?? event.createdAt,
        tool: event.skill,
        callId: event.callId,
        arguments: current?.arguments,
        message: event.message,
        resultContent: current?.resultContent,
        status: normalizeToolStatus(event.status),
        percent: event.percent,
        meta: current?.meta ?? event.meta,
      }));
      continue;
    }

    upsertToolTrace(event, (current) => ({
      id: current?.id ?? event.callId ?? event.id,
      kind: 'tool_trace',
      sessionId: event.sessionId,
      createdAt: current?.createdAt ?? event.createdAt,
      tool: event.skill,
      callId: event.callId,
      arguments: current?.arguments,
      message: event.message,
      resultContent: event.content ?? current?.resultContent,
      status: 'success',
      percent: current?.percent,
      meta: event.meta ?? current?.meta,
    }));
  }

  return compactConsecutiveToolTraces(items);
};

export const buildRenderableTimeline = (events: StoredEvent[]): RenderableTimeline => ({
  items: buildTimelineItems(events.filter((event) => !isThinkingEvent(event))),
  activeThinking: events.filter(isThinkingEvent).at(-1),
});
