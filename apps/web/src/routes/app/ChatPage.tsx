import type { ClipboardEvent as ReactClipboardEvent } from 'react';
import { forwardRef, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import type {
  FileRecord,
  StoredEvent,
  TextMessageEvent,
  ThinkingEvent,
} from '@skillchat/shared';
import { ApiError, api } from '@/lib/api';
import { MessageItem } from '@/components/MessageItem';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';
import { useSessionStream } from '@/hooks/useSessionStream';
import {
  composerAttachmentsActions,
  createComposerAttachmentId,
  type ComposerAttachment,
  useComposerAttachments,
} from '@/hooks/useComposerAttachments';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';
import { useAutoScrollToBottom } from '@/hooks/useAutoScrollToBottom';
import { buildRenderableTimeline, type TimelineItem } from '@/lib/timeline';
import { ChatHeader } from '@/components/layout/ChatHeader';
import { Composer } from '@/components/chat/Composer';
import { FollowUpQueue } from '@/components/chat/FollowUpQueue';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  QuestionTimelineControl,
  type QuestionTimelineEntry,
} from '@/components/chat/QuestionTimelineControl';
import { cn } from '@/lib/cn';
import { useAppShellOutlet } from './AppShellContext';

const normalizeAttachmentFile = (file: File, index: number) => {
  if (file.name.trim()) {
    return file;
  }
  const extension = file.type.startsWith('image/')
    ? file.type.replace('image/', '') || 'png'
    : 'bin';
  return new File([file], `pasted-image-${Date.now()}-${index + 1}.${extension}`, {
    type: file.type || 'application/octet-stream',
    lastModified: Date.now(),
  });
};

const SCROLL_BOTTOM_THRESHOLD_PX = 48;

const readScrollState = (node: HTMLElement) => {
  const distanceFromBottom = node.scrollHeight - (node.scrollTop + node.clientHeight);
  return {
    scrollTop: node.scrollTop,
    scrollHeight: node.scrollHeight,
    clientHeight: node.clientHeight,
    wasAtBottom: distanceFromBottom <= SCROLL_BOTTOM_THRESHOLD_PX,
  };
};

const buildRuntimeThinkingEvent = (args: {
  sessionId: string;
  phase: string | null;
  phaseStartedAt: string | null;
  round: number | null;
}): ThinkingEvent | undefined => {
  if (!args.phaseStartedAt) {
    return undefined;
  }

  let content: string | null = null;
  if (args.phase === 'sampling') {
    content = args.round && args.round > 1 ? '继续处理追加引导' : '正在分析需求';
  } else if (args.phase === 'tool_call') {
    content = '正在调用工具';
  } else if (args.phase === 'waiting_tool_result') {
    content = '等待工具结果';
  } else if (args.phase === 'finalizing') {
    content = '正在整理最终回复';
  }

  if (!content) {
    return undefined;
  }

  return {
    id: `runtime-thinking-${args.sessionId}`,
    sessionId: args.sessionId,
    kind: 'thinking',
    content,
    createdAt: args.phaseStartedAt,
  };
};

const hasPersistedTurnResult = (events: StoredEvent[], startedAt: string | null) => {
  if (!startedAt) {
    return false;
  }
  const startedAtMs = Date.parse(startedAt);
  if (Number.isNaN(startedAtMs)) {
    return false;
  }
  return events.some((event) => {
    const eventAtMs = Date.parse(event.createdAt);
    if (Number.isNaN(eventAtMs) || eventAtMs < startedAtMs) {
      return false;
    }
    if (event.kind === 'message') {
      return event.role === 'assistant';
    }
    return event.kind === 'image' || event.kind === 'file' || event.kind === 'error';
  });
};

interface EmptyStateProps {
  title: string;
  detail: string;
  action?: React.ReactNode;
}

const EmptyState = ({ title, detail, action }: EmptyStateProps) => (
  <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
    <h3 className="text-lg font-medium">{title}</h3>
    <p className="max-w-md text-sm text-foreground-muted">{detail}</p>
    {action}
  </div>
);

interface TimelineEventListProps {
  timeline: TimelineItem[];
  highlightedEventId: string | null;
  bindMessageNode: (eventId: string) => (node: HTMLDivElement | null) => void;
  onDownload: (file: FileRecord) => void;
  onReuseImage: (file: FileRecord) => void;
  downloading: boolean;
  canExpandToolTrace: boolean;
}

const TimelineEventList = memo(({
  timeline,
  highlightedEventId,
  bindMessageNode,
  onDownload,
  onReuseImage,
  downloading,
  canExpandToolTrace,
}: TimelineEventListProps) => (
  <>
    {timeline.map((event) => (
      <div
        key={event.id}
        ref={bindMessageNode(event.id)}
        className={cn(
          'scroll-mt-6 rounded-2xl transition-[box-shadow,background-color] duration-300',
          highlightedEventId === event.id &&
            'bg-accent/5 shadow-[0_0_0_2px_var(--accent)]',
        )}
      >
        <MessageItem
          event={event}
          onDownload={onDownload}
          onReuseImage={onReuseImage}
          downloading={downloading}
          canExpandToolTrace={canExpandToolTrace}
        />
      </div>
    ))}
  </>
));
TimelineEventList.displayName = 'TimelineEventList';

interface ChatComposerPanelProps {
  activeSessionId: string | null;
  onSubmit: (content: string) => void;
  onPaste: (event: ReactClipboardEvent<HTMLTextAreaElement>) => void;
  attachments: ComposerAttachment[];
  onRemoveAttachment: (localId: string) => void;
  onSelectFiles: (files: File[]) => void;
  isTurnRunning: boolean;
  onInterrupt: () => void;
  interruptPending: boolean;
  sendPending: boolean;
  disabled: boolean;
  hasUploadingAttachments: boolean;
  placeholder: string;
  bottomInsetPx: number;
}

const ChatComposerPanel = memo(forwardRef<HTMLTextAreaElement, ChatComposerPanelProps>(
  function ChatComposerPanel({
    activeSessionId,
    onSubmit,
    onPaste,
    attachments,
    onRemoveAttachment,
    onSelectFiles,
    isTurnRunning,
    onInterrupt,
    interruptPending,
    sendPending,
    disabled,
    hasUploadingAttachments,
    placeholder,
    bottomInsetPx,
  }, ref) {
    const draft = useUiStore((state) => (activeSessionId ? state.drafts[activeSessionId] ?? '' : ''));
    const setDraft = useUiStore((state) => state.setDraft);

    const handleSend = useCallback(() => {
      const value = draft.trim();
      if (
        !activeSessionId ||
        !value ||
        disabled ||
        hasUploadingAttachments ||
        sendPending ||
        interruptPending
      ) {
        return;
      }
      setDraft(activeSessionId, '');
      onSubmit(value);
    }, [
      activeSessionId,
      disabled,
      draft,
      hasUploadingAttachments,
      interruptPending,
      onSubmit,
      sendPending,
      setDraft,
    ]);

    return (
      <Composer
        ref={ref}
        value={draft}
        onValueChange={(value) => activeSessionId && setDraft(activeSessionId, value)}
        onSend={handleSend}
        onPaste={onPaste}
        attachments={attachments}
        onRemoveAttachment={onRemoveAttachment}
        onSelectFiles={onSelectFiles}
        isTurnRunning={isTurnRunning}
        onInterrupt={onInterrupt}
        interruptPending={interruptPending}
        sendPending={sendPending}
        disabled={disabled}
        hasUploadingAttachments={hasUploadingAttachments}
        placeholder={placeholder}
        bottomInsetPx={bottomInsetPx}
      />
    );
  },
));
ChatComposerPanel.displayName = 'ChatComposerPanel';

const formatCompactCount = (value: number) => {
  if (!Number.isFinite(value) || value <= 0) {
    return '0';
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`;
  }

  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1).replace(/\.?0+$/, '')}K`;
  }

  return String(value);
};

const getShortTurnId = (turnId: string | null | undefined) => {
  if (!turnId) {
    return null;
  }
  const normalized = turnId.replace(/^turn[_-]?/i, '');
  return normalized.length > 8 ? normalized.slice(0, 8) : normalized;
};

const buildOptimisticAttachments = (args: {
  attachmentIds: string[];
  cachedFiles: FileRecord[];
  composerAttachments: Array<{
    fileId?: string;
    displayName: string;
    mimeType: string | null;
    size: number;
  }>;
  userId: string;
  sessionId: string;
}) => {
  const cachedById = new Map(args.cachedFiles.map((file) => [file.id, file]));
  return args.attachmentIds
    .map<FileRecord | null>((fileId) => {
      const cached = cachedById.get(fileId);
      if (cached) {
        return cached;
      }
      const composerEntry = args.composerAttachments.find((item) => item.fileId === fileId);
      if (!composerEntry) {
        return null;
      }
      return {
        id: fileId,
        userId: args.userId,
        sessionId: args.sessionId,
        displayName: composerEntry.displayName,
        relativePath: '',
        mimeType: composerEntry.mimeType,
        size: composerEntry.size,
        bucket: 'uploads',
        source: 'upload',
        createdAt: new Date().toISOString(),
        downloadUrl: `/api/files/${fileId}/download`,
      } satisfies FileRecord;
    })
    .filter((item): item is FileRecord => item !== null);
};

export const ChatPage = () => {
  const queryClient = useQueryClient();
  const { sessionId } = useParams();
  const activeSessionId = sessionId ?? null;
  const user = useAuthStore((state) => state.user)!;

  const {
    setPageError,
    openCreateSessionDialog,
    openSidebarSheet,
    openInspectorSheet,
    themeMode,
    onToggleTheme,
    sessionActionPending,
    onRenameSession,
    onDeleteSession,
  } = useAppShellOutlet();

  const setDraft = useUiStore((state) => state.setDraft);
  const clearActiveTurn = useUiStore((state) => state.clearActiveTurn);
  const clearStreamContent = useUiStore((state) => state.clearStreamContent);
  const hydrateRuntime = useUiStore((state) => state.hydrateRuntime);
  const confirmRemovedFollowUpInput = useUiStore((state) => state.confirmRemovedFollowUpInput);
  const setSessionScrollState = useUiStore((state) => state.setSessionScrollState);

  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messageNodeRefs = useRef(new Map<string, HTMLDivElement>());
  const restoredScrollSessionIdRef = useRef<string | null>(null);
  const highlightTimerRef = useRef<number | null>(null);
  const [highlightedEventId, setHighlightedEventId] = useState<string | null>(null);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameTitle, setRenameTitle] = useState('');
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const stream = useSessionStream(activeSessionId);
  const keyboardInset = useKeyboardInset();
  const { attachments: composerAttachments, update: updateAttachments, clear: clearAttachments } =
    useComposerAttachments(activeSessionId);

  const sessionsQuery = useQuery({
    queryKey: ['sessions'],
    queryFn: api.listSessions,
    enabled: Boolean(user),
  });

  const skillsQuery = useQuery({
    queryKey: ['skills'],
    queryFn: api.listSkills,
    enabled: Boolean(user),
  });

  const activeSession = useMemo(
    () => sessionsQuery.data?.find((item) => item.id === activeSessionId) ?? null,
    [activeSessionId, sessionsQuery.data],
  );
  const hasActiveSession = Boolean(activeSessionId && activeSession);

  useEffect(() => {
    if (!renameDialogOpen) {
      setRenameTitle(activeSession?.title ?? '');
    }
  }, [activeSession?.title, renameDialogOpen]);

  useEffect(() => {
    setRenameDialogOpen(false);
    setDeleteDialogOpen(false);
  }, [activeSessionId]);

  useEffect(() => {
    messageNodeRefs.current.clear();
    restoredScrollSessionIdRef.current = null;
    setHighlightedEventId(null);
  }, [activeSessionId]);

  useEffect(() => () => {
    if (highlightTimerRef.current) {
      window.clearTimeout(highlightTimerRef.current);
    }
  }, []);

  const messagesQuery = useQuery({
    queryKey: ['messages', activeSessionId],
    queryFn: () => api.listMessages(activeSessionId!),
    enabled: Boolean(activeSessionId && activeSession),
  });

  const runtimeQuery = useQuery({
    queryKey: ['runtime', activeSessionId],
    queryFn: () => api.getSessionRuntime(activeSessionId!),
    enabled: Boolean(activeSessionId && activeSession),
    refetchOnMount: 'always',
  });

  const installedSkills = skillsQuery.data ?? [];
  const activeSkills = activeSession?.activeSkills ?? [];
  const activeSkillEntries = useMemo(
    () => installedSkills.filter((skill) => activeSkills.includes(skill.name)),
    [activeSkills, installedSkills],
  );
  const emptyStateStarterPrompts = useMemo(
    () =>
      Array.from(new Set(activeSkillEntries.flatMap((skill) => skill.starterPrompts ?? []))).slice(
        0,
        6,
      ),
    [activeSkillEntries],
  );
  const emptyStateStarterCaption =
    activeSkillEntries.length > 0
      ? `当前会话已启用：${activeSkillEntries.map((skill) => skill.name).join(' · ')}`
      : null;

  useEffect(() => {
    if (activeSessionId && runtimeQuery.data && runtimeQuery.isFetchedAfterMount) {
      hydrateRuntime(activeSessionId, runtimeQuery.data);
    }
  }, [activeSessionId, hydrateRuntime, runtimeQuery.data, runtimeQuery.isFetchedAfterMount]);

  useEffect(() => {
    if (
      !activeSessionId ||
      !runtimeQuery.data ||
      !runtimeQuery.isFetchedAfterMount ||
      runtimeQuery.data.activeTurn !== null ||
      !stream.activeTurnId ||
      !hasPersistedTurnResult(messagesQuery.data ?? [], stream.activeTurnStartedAt)
    ) {
      return;
    }

    clearActiveTurn(activeSessionId);
    clearStreamContent(activeSessionId);
  }, [
    activeSessionId,
    clearActiveTurn,
    clearStreamContent,
    messagesQuery.data,
    runtimeQuery.data,
    runtimeQuery.isFetchedAfterMount,
    stream.activeTurnId,
    stream.activeTurnStartedAt,
  ]);

  const sendMessageMutation = useMutation({
    mutationFn: (payload: {
      sessionId: string;
      content: string;
      attachmentIds: string[];
      activeTurnId: string | null;
    }) => {
      if (payload.activeTurnId) {
        return api.sendMessage(payload.sessionId, {
          content: payload.content,
          attachmentIds: payload.attachmentIds,
          dispatch: 'auto',
          turnId: payload.activeTurnId,
        });
      }
      return api.sendMessage(payload.sessionId, {
        content: payload.content,
        attachmentIds: payload.attachmentIds,
        dispatch: 'new_turn',
      });
    },
    onMutate: async (payload) => {
      if (payload.sessionId) {
        const shouldOptimisticallyAppend = !stream.activeTurnId;
        if (shouldOptimisticallyAppend) {
          clearStreamContent(payload.sessionId);
        }
        const previous =
          queryClient.getQueryData<StoredEvent[]>(['messages', payload.sessionId]) ?? [];
        if (shouldOptimisticallyAppend) {
          const cachedFiles =
            queryClient.getQueryData<FileRecord[]>(['files', payload.sessionId]) ?? [];
          const optimisticAttachments = buildOptimisticAttachments({
            attachmentIds: payload.attachmentIds,
            cachedFiles,
            composerAttachments,
            userId: user.id,
            sessionId: payload.sessionId,
          });

          const optimisticMessage: TextMessageEvent = {
            id: `optimistic-${Date.now()}`,
            sessionId: payload.sessionId,
            kind: 'message',
            role: 'user',
            type: 'text',
            content: payload.content,
            createdAt: new Date().toISOString(),
            ...(optimisticAttachments.length > 0
              ? { attachments: optimisticAttachments }
              : {}),
          };

          queryClient.setQueryData<StoredEvent[]>(['messages', payload.sessionId], [
            ...previous,
            optimisticMessage,
          ]);
        }
        return { previous, shouldOptimisticallyAppend };
      }
      return { previous: [] as StoredEvent[], shouldOptimisticallyAppend: false };
    },
    onSuccess: (payload, variables) => {
      if (variables.sessionId) {
        queryClient.setQueryData(['runtime', variables.sessionId], payload.runtime);
        hydrateRuntime(variables.sessionId, payload.runtime);
        clearAttachments(variables.sessionId);
      }
    },
    onError: (error, variables, context) => {
      if (variables.sessionId && context?.previous && context.shouldOptimisticallyAppend) {
        queryClient.setQueryData(['messages', variables.sessionId], context.previous);
      }
      setPageError(error instanceof ApiError ? error.message : '发送消息失败');
    },
  });
  const sendMessageRef = useRef(sendMessageMutation.mutate);

  useEffect(() => {
    sendMessageRef.current = sendMessageMutation.mutate;
  }, [sendMessageMutation.mutate]);

  const interruptMutation = useMutation({
    mutationFn: () => api.interruptTurn(activeSessionId!, stream.activeTurnId!),
    onSuccess: (payload) => {
      if (activeSessionId) {
        queryClient.setQueryData(['runtime', activeSessionId], payload.runtime);
        hydrateRuntime(activeSessionId, payload.runtime);
      }
    },
    onError: (error) => setPageError(error instanceof ApiError ? error.message : '中断失败'),
  });
  const interruptTurnRef = useRef(interruptMutation.mutate);

  useEffect(() => {
    interruptTurnRef.current = interruptMutation.mutate;
  }, [interruptMutation.mutate]);

  const removeFollowUpInputMutation = useMutation({
    mutationFn: (inputId: string) => api.removeFollowUpInput(activeSessionId!, inputId),
    onSuccess: (payload) => {
      if (activeSessionId) {
        confirmRemovedFollowUpInput(activeSessionId, payload.inputId);
        queryClient.setQueryData(['runtime', activeSessionId], payload.runtime);
        hydrateRuntime(activeSessionId, payload.runtime);
      }
    },
    onError: (error) =>
      setPageError(error instanceof ApiError ? error.message : '取消待处理输入失败'),
  });

  const uploadMutation = useMutation({
    mutationFn: ({ sessionId: targetSessionId, file }: { sessionId: string; file: File }) =>
      api.uploadFile(targetSessionId, file),
    onSuccess: async (_record, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['files', variables.sessionId] }),
        queryClient.invalidateQueries({ queryKey: ['messages', variables.sessionId] }),
      ]);
    },
    onError: (error) => setPageError(error instanceof ApiError ? error.message : '上传失败'),
  });
  const uploadFileRef = useRef(uploadMutation.mutateAsync);

  useEffect(() => {
    uploadFileRef.current = uploadMutation.mutateAsync;
  }, [uploadMutation.mutateAsync]);

  const downloadMutation = useMutation({
    mutationFn: (file: FileRecord) => api.downloadFile(file),
    onError: (error) => setPageError(error instanceof ApiError ? error.message : '下载失败'),
  });
  const downloadFileRef = useRef(downloadMutation.mutate);

  useEffect(() => {
    downloadFileRef.current = downloadMutation.mutate;
  }, [downloadMutation.mutate]);

  const { items: timeline, activeThinking } = useMemo<{
    items: TimelineItem[];
    activeThinking?: Extract<StoredEvent, { kind: 'thinking' }>;
  }>(
    () =>
      buildRenderableTimeline([...(messagesQuery.data ?? []), ...stream.transientEvents]),
    [messagesQuery.data, stream.transientEvents],
  );
  const questionTimeline = useMemo<QuestionTimelineEntry[]>(
    () =>
      timeline
        .filter(
          (item): item is TextMessageEvent =>
            item.kind === 'message' && item.role === 'user',
        )
        .map((item, index) => ({
          id: item.id,
          index: index + 1,
          content: item.content,
          createdAt: item.createdAt,
        })),
    [timeline],
  );
  const thinkingEvent = useMemo(() => {
    if (
      activeSessionId &&
      stream.status === 'reconnecting' &&
      stream.reconnectAttempt &&
      stream.reconnectLimit &&
      (stream.activeTurnId || activeThinking || stream.activeTurnPhaseStartedAt)
    ) {
      return {
        id: `runtime-reconnecting-${activeSessionId}`,
        sessionId: activeSessionId,
        kind: 'thinking' as const,
        content: `重连中${stream.reconnectAttempt}/${stream.reconnectLimit}`,
        createdAt:
          activeThinking?.createdAt ?? stream.activeTurnPhaseStartedAt ?? new Date().toISOString(),
      };
    }

    return (
      activeThinking ??
      (activeSessionId
        ? buildRuntimeThinkingEvent({
            sessionId: activeSessionId,
            phase: stream.activeTurnPhase,
            phaseStartedAt: stream.activeTurnPhaseStartedAt,
            round: stream.activeTurnRound,
          })
        : undefined)
    );
  }, [
    activeSessionId,
    activeThinking,
    stream.activeTurnId,
    stream.activeTurnPhase,
    stream.activeTurnPhaseStartedAt,
    stream.activeTurnRound,
    stream.reconnectAttempt,
    stream.reconnectLimit,
    stream.status,
  ]);

  const shouldRenderPendingText = useMemo(() => {
    if (!stream.pendingText) {
      return false;
    }
    for (let index = timeline.length - 1; index >= 0; index -= 1) {
      const item = timeline[index];
      if (item?.kind === 'message' && item.role === 'assistant') {
        return item.content !== stream.pendingText;
      }
    }
    return true;
  }, [stream.pendingText, timeline]);

  const messageListRef = useAutoScrollToBottom<HTMLDivElement>([
    timeline,
    thinkingEvent,
    stream.pendingText,
    stream.followUpQueue,
    activeSessionId,
  ]);

  const saveSessionScrollPosition = (sessionId: string, node: HTMLElement) => {
    setSessionScrollState(sessionId, readScrollState(node));
  };

  useEffect(() => {
    if (
      !activeSessionId ||
      !messagesQuery.isSuccess ||
      restoredScrollSessionIdRef.current === activeSessionId
    ) {
      return;
    }

    const node = messageListRef.current;
    if (!node) {
      return;
    }

    const saved = useUiStore.getState().sessionScrollStates[activeSessionId];
    const maxScrollTop = Math.max(0, node.scrollHeight - node.clientHeight);
    node.scrollTop = saved
      ? saved.wasAtBottom
        ? maxScrollTop
        : Math.min(saved.scrollTop, maxScrollTop)
      : maxScrollTop;

    saveSessionScrollPosition(activeSessionId, node);
    restoredScrollSessionIdRef.current = activeSessionId;
  }, [
    activeSessionId,
    messageListRef,
    messagesQuery.isSuccess,
    setSessionScrollState,
    timeline.length,
  ]);

  const handleMessageListScroll = () => {
    if (!activeSessionId) {
      return;
    }
    const node = messageListRef.current;
    if (!node) {
      return;
    }
    saveSessionScrollPosition(activeSessionId, node);
  };

  const bindMessageNode = useCallback((eventId: string) => (node: HTMLDivElement | null) => {
    if (node) {
      messageNodeRefs.current.set(eventId, node);
      return;
    }
    messageNodeRefs.current.delete(eventId);
  }, []);

  const handleSelectQuestionFromTimeline = (eventId: string) => {
    const node = messageNodeRefs.current.get(eventId);
    if (!node) {
      return;
    }
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setHighlightedEventId(eventId);
    if (highlightTimerRef.current) {
      window.clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedEventId(null);
      highlightTimerRef.current = null;
    }, 1800);
  };

  const isTurnRunning =
    Boolean(stream.activeTurnId) &&
    (stream.activeTurnStatus === 'running' || stream.activeTurnStatus === 'interrupting');
  const hasUploadingAttachments = composerAttachments.some((item) => item.status === 'uploading');

  const uploadComposerFiles = useCallback(async (files: File[]) => {
    if (!activeSessionId || files.length === 0) {
      return;
    }

    setPageError(null);
    for (const [index, rawFile] of files.entries()) {
      const file = normalizeAttachmentFile(rawFile, index);
      const localId = createComposerAttachmentId();
      updateAttachments(activeSessionId, (current) => [
        ...current,
        {
          localId,
          displayName: file.name,
          mimeType: file.type || null,
          size: file.size,
          status: 'uploading',
        },
      ]);

      try {
        const record = await uploadFileRef.current({
          sessionId: activeSessionId,
          file,
        });
        updateAttachments(activeSessionId, (current) =>
          current.map((item) =>
            item.localId === localId
              ? {
                  ...item,
                  fileId: record.id,
                  displayName: record.displayName,
                  mimeType: record.mimeType,
                  size: record.size,
                  status: 'uploaded',
                }
              : item,
          ),
        );
      } catch {
        updateAttachments(activeSessionId, (current) =>
          current.filter((item) => item.localId !== localId),
        );
      }
    }
  }, [activeSessionId, setPageError, updateAttachments]);

  const handleComposerPaste = useCallback((event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const pastedImagesFromItems = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    const pastedImages =
      pastedImagesFromItems.length > 0
        ? pastedImagesFromItems
        : Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'));

    if (pastedImages.length === 0) {
      return;
    }

    event.preventDefault();
    void uploadComposerFiles(pastedImages);
  }, [uploadComposerFiles]);

  const handleRemoveComposerAttachment = useCallback((localId: string) => {
    if (!activeSessionId) {
      return;
    }
    updateAttachments(activeSessionId, (current) =>
      current.filter((item) => item.localId !== localId),
    );
  }, [activeSessionId, updateAttachments]);

  const handleSelectComposerFiles = useCallback((files: File[]) => {
    void uploadComposerFiles(files);
  }, [uploadComposerFiles]);

  const handleInterruptTurn = useCallback(() => {
    interruptTurnRef.current();
  }, []);

  const handleReuseImage = useCallback((file: FileRecord) => {
    if (!activeSessionId) {
      return;
    }
    composerAttachmentsActions.addFromFileRecord(activeSessionId, file);
  }, [activeSessionId]);

  const handleDownloadFile = useCallback((file: FileRecord) => {
    downloadFileRef.current(file);
  }, []);

  const handleSubmitDraft = useCallback((content: string) => {
    if (
      !activeSessionId ||
      !content.trim() ||
      hasUploadingAttachments ||
      sendMessageMutation.isPending ||
      interruptMutation.isPending
    ) {
      return;
    }
    const value = content.trim();
    const attachmentIds = composerAttachments
      .filter((item) => item.status === 'uploaded' && typeof item.fileId === 'string')
      .map((item) => item.fileId as string);
    setPageError(null);
    sendMessageRef.current({
      sessionId: activeSessionId,
      content: value,
      attachmentIds,
      activeTurnId: stream.activeTurnId,
    });
  }, [
    activeSessionId,
    composerAttachments,
    hasUploadingAttachments,
    interruptMutation.isPending,
    sendMessageMutation.isPending,
    setPageError,
    stream.activeTurnId,
  ]);

  const handleEmptyStatePromptClick = (prompt: string) => {
    if (!activeSessionId) {
      return;
    }
    setDraft(activeSessionId, prompt);
    const focusComposer = () => {
      composerTextareaRef.current?.focus();
      composerTextareaRef.current?.setSelectionRange(prompt.length, prompt.length);
    };
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(focusComposer);
      return;
    }
    focusComposer();
  };

  const openRenameDialog = () => {
    if (!activeSession) {
      return;
    }
    setRenameTitle(activeSession.title);
    setRenameDialogOpen(true);
  };

  const submitRename = () => {
    if (!activeSessionId || !renameTitle.trim()) {
      return;
    }
    onRenameSession(activeSessionId, renameTitle.trim());
    setRenameDialogOpen(false);
  };

  const confirmDeleteSession = () => {
    if (!activeSessionId || isTurnRunning) {
      return;
    }
    onDeleteSession(activeSessionId);
    setDeleteDialogOpen(false);
  };

  const sessionTurnCount = useMemo(() => {
    const turnIds = new Set<string>();
    for (const item of timeline) {
      if (item.kind === 'message' && item.role === 'assistant' && item.meta?.turnId) {
        turnIds.add(item.meta.turnId);
      }
    }
    if (stream.activeTurnId) {
      turnIds.add(stream.activeTurnId);
    }
    return Math.max(runtimeQuery.data?.tokenUsage?.turnCount ?? 0, turnIds.size);
  }, [runtimeQuery.data?.tokenUsage?.turnCount, stream.activeTurnId, timeline]);
  const activeTurnShortId = getShortTurnId(stream.activeTurnId ?? runtimeQuery.data?.activeTurn?.turnId);
  const activeRound = stream.activeTurnRound ?? runtimeQuery.data?.activeTurn?.round ?? 0;
  const persistedTokenTotal = runtimeQuery.data?.tokenUsage?.totalTokens;
  const streamedTokenTotal = stream.currentTurnTokenUsage?.cumulativeTotalTokens ?? stream.currentTurnTokenUsage?.totalTokens;
  const messageTokenTotal = useMemo(
    () =>
      timeline.reduce((total, item) => {
        if (item.kind !== 'message' || item.role !== 'assistant') {
          return total;
        }
        return total + (item.meta?.tokenUsage?.totalTokens ?? 0);
      }, 0),
    [timeline],
  );
  const totalTokens = streamedTokenTotal ?? persistedTokenTotal ?? messageTokenTotal;
  const hasFollowUpQueue = stream.followUpQueue.length > 0;
  const headerSubtitle = hasActiveSession ? (
    <>
      Turn：{sessionTurnCount || '-'}
      {activeTurnShortId ? <>（{activeTurnShortId}）</> : null}
      {' '}· Round：{activeRound || '-'}
      {' '}· 总消耗 token：{formatCompactCount(totalTokens)}
      {isTurnRunning && stream.activeTurnPhase ? <> · {stream.activeTurnPhase}</> : null}
    </>
  ) : (
    <>暂未进入会话，请先创建会话并选择本会话允许使用的 skills。</>
  );

  return (
    <main className="relative flex h-full min-h-0 flex-1 flex-col">
      <ChatHeader
        title={activeSession?.title ?? '选择或创建会话'}
        subtitle={headerSubtitle}
        onTitleClick={hasActiveSession ? openRenameDialog : undefined}
        titleActions={hasActiveSession ? (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setDeleteDialogOpen(true)}
            disabled={sessionActionPending || isTurnRunning}
            aria-label={`删除会话：${activeSession?.title ?? ''}`}
            title={isTurnRunning ? '当前会话回应中，暂不能删除' : '删除会话'}
            className="text-foreground-muted hover:text-danger disabled:opacity-40"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        ) : undefined}
        themeMode={themeMode}
        onToggleTheme={onToggleTheme}
        onOpenSidebar={openSidebarSheet}
        onOpenInspector={() => openInspectorSheet('files')}
      />

      {hasActiveSession ? (
        <>
          <section className="message-stage relative flex-1 overflow-hidden">
            <div
              ref={messageListRef}
              className="message-list h-full overflow-y-auto"
              onScroll={handleMessageListScroll}
            >
              <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6">
                {stream.recovery ? (
                  <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-foreground-muted">
                    已从重启中恢复：之前的 {stream.recovery.previousTurnKind} turn （
                    {stream.recovery.previousTurnId}）已中断，未提交输入已恢复到待处理队列。
                  </div>
                ) : null}
                {timeline.length === 0 &&
                !stream.pendingText &&
                !thinkingEvent &&
                stream.followUpQueue.length === 0 ? (
                  <EmptyState
                    title="开始一个任务"
                    detail={
                      emptyStateStarterPrompts.length > 0
                        ? '你可以先点一个预设开场白，内容会直接进入聊天框，随后继续修改或发送。'
                        : '可以直接聊天或上传文件；如果要启用特定 skill，先在右侧面板把它加入当前会话。'
                    }
                    action={
                      emptyStateStarterPrompts.length > 0 ? (
                        <div className="flex flex-col items-center gap-2">
                          {emptyStateStarterCaption ? (
                            <div className="text-2xs text-foreground-muted">
                              {emptyStateStarterCaption}
                            </div>
                          ) : null}
                          <div className="flex flex-wrap justify-center gap-2">
                            {emptyStateStarterPrompts.map((prompt) => (
                              <button
                                key={prompt}
                                type="button"
                                onClick={() => handleEmptyStatePromptClick(prompt)}
                                className="rounded-full border border-border bg-surface px-3 py-1 text-xs text-foreground transition-colors hover:bg-surface-hover"
                              >
                                {prompt}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : undefined
                    }
                  />
                ) : null}
                <TimelineEventList
                  timeline={timeline}
                  highlightedEventId={highlightedEventId}
                  bindMessageNode={bindMessageNode}
                  onDownload={handleDownloadFile}
                  onReuseImage={handleReuseImage}
                  downloading={downloadMutation.isPending}
                  canExpandToolTrace={user.role === 'admin'}
                />
                {shouldRenderPendingText ? (
                  <MessageItem
                    event={{ kind: 'pending_text', content: stream.pendingText }}
                    assistantMeta={{
                      durationMs: stream.activeTurnStartedAt
                        ? Math.max(0, Date.now() - new Date(stream.activeTurnStartedAt).getTime())
                        : undefined,
                      tokenUsage: stream.currentTurnTokenUsage ?? undefined,
                      reasoningSummary: stream.reasoningSummary || undefined,
                    }}
                    onDownload={handleDownloadFile}
                    onReuseImage={handleReuseImage}
                    downloading={downloadMutation.isPending}
                    canExpandToolTrace={user.role === 'admin'}
                  />
                ) : null}
                {thinkingEvent ? (
                  <MessageItem
                    key={thinkingEvent.id}
                    event={thinkingEvent}
                    onDownload={handleDownloadFile}
                    onReuseImage={handleReuseImage}
                    downloading={downloadMutation.isPending}
                    canExpandToolTrace={user.role === 'admin'}
                  />
                ) : null}
              </div>
            </div>
            <QuestionTimelineControl
              questions={questionTimeline}
              activeQuestionId={highlightedEventId}
              onSelectQuestion={handleSelectQuestionFromTimeline}
            />
          </section>

          {hasFollowUpQueue ? (
            <div
              className="border-t border-border bg-background px-4 pt-3"
              style={{
                paddingBottom: `calc(0px + env(safe-area-inset-bottom) + ${keyboardInset}px)`,
              }}
            >
              <div className="mx-auto max-w-3xl">
                <FollowUpQueue
                  queue={stream.followUpQueue}
                  onCancel={(inputId) => removeFollowUpInputMutation.mutate(inputId)}
                  cancelDisabled={removeFollowUpInputMutation.isPending}
                />
              </div>
            </div>
          ) : null}
          <ChatComposerPanel
            ref={composerTextareaRef}
            activeSessionId={activeSessionId}
            onSubmit={handleSubmitDraft}
            onPaste={handleComposerPaste}
            attachments={composerAttachments}
            onRemoveAttachment={handleRemoveComposerAttachment}
            onSelectFiles={handleSelectComposerFiles}
            isTurnRunning={isTurnRunning}
            onInterrupt={handleInterruptTurn}
            interruptPending={interruptMutation.isPending}
            sendPending={sendMessageMutation.isPending}
            disabled={!activeSessionId}
            hasUploadingAttachments={hasUploadingAttachments}
            placeholder={isTurnRunning ? '继续补充信息，系统会按顺序处理' : '给 SkillChat 发送消息'}
            bottomInsetPx={keyboardInset}
          />
        </>
      ) : (
        <section className="message-stage flex-1 overflow-hidden">
          <div className="message-list flex h-full items-center justify-center">
            <EmptyState
              title="还没有会话"
              detail="先创建一个会话，并明确选择这个会话允许使用哪些 skill。未选择的 skill 不会进入上下文，也不可调用。"
              action={
                <div className="flex flex-col items-center gap-2">
                  <button
                    type="button"
                    onClick={openCreateSessionDialog}
                    className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:brightness-110"
                  >
                    新建会话
                  </button>
                  <div className="text-2xs text-foreground-muted">
                    会话创建后，你仍然可以在右侧面板调整当前会话启用的 skill 范围。
                  </div>
                </div>
              }
            />
          </div>
        </section>
      )}

      <Dialog open={renameDialogOpen} onOpenChange={setRenameDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>修改标题</DialogTitle>
            <DialogDescription>给当前会话换一个更容易识别的名称。</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              submitRename();
            }}
          >
            <Input
              aria-label="会话标题"
              value={renameTitle}
              onChange={(event) => setRenameTitle(event.target.value)}
              maxLength={80}
              autoFocus
            />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setRenameDialogOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={sessionActionPending || !renameTitle.trim()}>
                保存
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除会话</DialogTitle>
            <DialogDescription>
              删除后会从会话列表移除，相关聊天记录和会话文件会进入服务端回收目录。
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-border bg-surface-hover px-3 py-2 text-sm">
            {activeSession?.title}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDeleteDialogOpen(false)}>
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmDeleteSession}
              disabled={sessionActionPending || isTurnRunning}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
};

export default ChatPage;
