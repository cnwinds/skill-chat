import type { FileRecord, StoredEvent, ThinkingEvent } from '@skillchat/shared';

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

const internalGeneratedFileNames = new Set([
  '[content_types].xml',
  'app.xml',
  'comments.xml',
  'core.xml',
  'document.xml',
  'endnotes.xml',
  'fonttable.xml',
  'footnotes.xml',
  'numbering.xml',
  'presentation.xml',
  'settings.xml',
  'sharedstrings.xml',
  'styles.xml',
  'theme1.xml',
  'websettings.xml',
  'workbook.xml',
]);

const internalGeneratedPathSegments = new Set([
  'tmp',
  'temp',
  'scratch',
  'intermediate',
  'intermediates',
  'parts',
  '_rels',
  'word',
  'xl',
  'ppt',
  'docprops',
  'customxml',
]);

const isLikelyIntermediateGeneratedFile = (file: FileRecord) => {
  if (file.source !== 'generated') {
    return false;
  }

  const name = file.displayName.toLowerCase();
  if (
    name.endsWith('.rels') ||
    name.endsWith('.tmp') ||
    name.endsWith('.temp') ||
    name.endsWith('.bak') ||
    name.endsWith('.map') ||
    internalGeneratedFileNames.has(name)
  ) {
    return true;
  }

  const normalizedPath = file.relativePath.replace(/\\/g, '/').toLowerCase();
  const segments = normalizedPath.split('/').filter(Boolean);
  const outputsIndex = segments.lastIndexOf('outputs');
  const artifactSegments = outputsIndex >= 0
    ? segments.slice(outputsIndex + 1, -1)
    : [];
  return artifactSegments.some((segment) => internalGeneratedPathSegments.has(segment));
};

const isHiddenFileEvent = (event: StoredEvent) => (
  event.kind === 'file' &&
  (
    event.file.visibility === 'hidden' ||
    (typeof event.file.visibility === 'undefined' && isLikelyIntermediateGeneratedFile(event.file))
  )
);

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
  items: ToolTraceDisplayEvent[],
): ToolTraceGroupDisplayEvent => {
  const firstItem = items[0]!;
  return {
    id: `${firstItem.id}-group`,
    kind: 'tool_trace_group',
    sessionId: firstItem.sessionId,
    createdAt: firstItem.createdAt,
    groupKey: 'consecutive_tool_traces',
    tool: firstItem.tool,
    status: aggregateToolStatus(items),
    items,
  };
};

const compactConsecutiveToolTraces = (items: TimelineItem[]): TimelineItem[] => {
  const compacted: TimelineItem[] = [];
  let currentGroup: ToolTraceDisplayEvent[] = [];

  const flushGroup = () => {
    if (currentGroup.length === 1) {
      compacted.push(currentGroup[0]!);
    } else if (currentGroup.length > 1) {
      compacted.push(createToolTraceGroup(currentGroup));
    }
    currentGroup = [];
  };

  for (const item of items) {
    if (item.kind !== 'tool_trace') {
      flushGroup();
      compacted.push(item);
      continue;
    }

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
    if (isHiddenFileEvent(event)) {
      continue;
    }

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
