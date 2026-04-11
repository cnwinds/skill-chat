import type { StoredEvent, ThinkingEvent } from '@skillchat/shared';

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
  status: 'queued' | 'running' | 'success' | 'failed';
  percent?: number;
  meta?: Record<string, unknown>;
};

export type TimelineItem = StoredEvent | ToolTraceDisplayEvent;

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

  return items;
};

export const buildRenderableTimeline = (events: StoredEvent[]): RenderableTimeline => ({
  items: buildTimelineItems(events.filter((event) => !isThinkingEvent(event))),
  activeThinking: events.filter(isThinkingEvent).at(-1),
});
