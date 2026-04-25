import type { ChangeEvent, ClipboardEvent as ReactClipboardEvent } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import type {
  FileRecord,
  StoredEvent,
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
  useComposerAttachments,
} from '@/hooks/useComposerAttachments';
import { useKeyboardInset } from '@/hooks/useKeyboardInset';
import { cn, formatBytes } from '@/lib/utils';
import { buildRenderableTimeline, type TimelineItem } from '@/lib/timeline';
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
  <div className="empty-state">
    <h3>{title}</h3>
    <p>{detail}</p>
    {action}
  </div>
);

export const ChatPage = () => {
  const queryClient = useQueryClient();
  const { sessionId } = useParams();
  const activeSessionId = sessionId ?? null;
  const user = useAuthStore((state) => state.user)!;

  const {
    pageError,
    setPageError,
    openCreateSessionDialog,
    themeMode,
    onToggleTheme,
    onLogout,
    logoutPending,
    mobilePanel,
    setMobilePanel,
    setInspectorTab,
  } = useAppShellOutlet();

  const drafts = useUiStore((state) => state.drafts);
  const setDraft = useUiStore((state) => state.setDraft);
  const clearActiveTurn = useUiStore((state) => state.clearActiveTurn);
  const clearStreamContent = useUiStore((state) => state.clearStreamContent);
  const hydrateRuntime = useUiStore((state) => state.hydrateRuntime);
  const confirmRemovedFollowUpInput = useUiStore((state) => state.confirmRemovedFollowUpInput);

  const messageListRef = useRef<HTMLDivElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);

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
          queryClient.setQueryData<StoredEvent[]>(['messages', payload.sessionId], [
            ...previous,
            {
              id: `optimistic-${Date.now()}`,
              sessionId: payload.sessionId,
              kind: 'message',
              role: 'user',
              type: 'text',
              content: payload.content,
              createdAt: new Date().toISOString(),
            },
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

  const downloadMutation = useMutation({
    mutationFn: (file: FileRecord) => api.downloadFile(file),
    onError: (error) => setPageError(error instanceof ApiError ? error.message : '下载失败'),
  });

  const { items: timeline, activeThinking } = useMemo<{
    items: TimelineItem[];
    activeThinking?: Extract<StoredEvent, { kind: 'thinking' }>;
  }>(
    () =>
      buildRenderableTimeline([...(messagesQuery.data ?? []), ...stream.transientEvents]),
    [messagesQuery.data, stream.transientEvents],
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

  useEffect(() => {
    const target = messageListRef.current;
    if (!target) {
      return;
    }
    target.scrollTop = target.scrollHeight;
  }, [timeline, thinkingEvent, stream.pendingText, stream.followUpQueue, activeSessionId]);

  const draft = hasActiveSession ? drafts[activeSessionId!] ?? '' : '';
  const isTurnRunning =
    Boolean(stream.activeTurnId) &&
    (stream.activeTurnStatus === 'running' || stream.activeTurnStatus === 'interrupting');
  const hasUploadingAttachments = composerAttachments.some((item) => item.status === 'uploading');

  const uploadComposerFiles = async (files: File[]) => {
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
        const record = await uploadMutation.mutateAsync({
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
  };

  const handleComposerFileSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.currentTarget.value = '';
    void uploadComposerFiles(files);
  };

  const handleComposerPaste = (event: ReactClipboardEvent<HTMLTextAreaElement>) => {
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
  };

  const handleReuseImage = (file: FileRecord) => {
    if (!activeSessionId) {
      return;
    }
    composerAttachmentsActions.addFromFileRecord(activeSessionId, file);
  };

  const handleSend = () => {
    if (
      !activeSessionId ||
      !draft.trim() ||
      hasUploadingAttachments ||
      sendMessageMutation.isPending ||
      interruptMutation.isPending
    ) {
      return;
    }
    const value = draft.trim();
    const attachmentIds = composerAttachments
      .filter((item) => item.status === 'uploaded' && typeof item.fileId === 'string')
      .map((item) => item.fileId as string);
    setDraft(activeSessionId, '');
    setPageError(null);
    sendMessageMutation.mutate({
      sessionId: activeSessionId,
      content: value,
      attachmentIds,
      activeTurnId: stream.activeTurnId,
    });
  };

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

  return (
    <main className="workspace">
      <header className="workspace-header">
        <div>
          <div className="eyebrow">SkillChat</div>
          <h1>{activeSession?.title ?? '选择或创建会话'}</h1>
          <p>
            当前用户：{user.username}
            {hasActiveSession ? (
              <>
                {' '}
                · 连接状态：
                <span className={cn('stream-pill', `is-${stream.status}`)}>{stream.status}</span>
                {isTurnRunning ? (
                  <>
                    {' '}
                    · 当前 turn：
                    <span className="stream-pill is-open">
                      {stream.activeTurnKind ?? 'regular'} / {stream.activeTurnPhase ?? 'running'}
                      {stream.activeTurnRound ? ` / round ${stream.activeTurnRound}` : ''}
                    </span>
                  </>
                ) : null}
              </>
            ) : (
              <> · 暂未进入会话，请先创建会话并选择本会话允许使用的 skills。</>
            )}
          </p>
          {hasActiveSession && activeSkills.length > 0 ? (
            <div className="skill-badge-list">
              {activeSkills.map((skillName) => (
                <span key={skillName} className="skill-badge active">
                  {skillName}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="header-actions">
          <button
            type="button"
            className="subtle-button mobile-only"
            onClick={() => setMobilePanel(mobilePanel === 'sessions' ? null : 'sessions')}
          >
            会话
          </button>
          <button
            type="button"
            className="subtle-button mobile-only"
            onClick={() => {
              setInspectorTab('files');
              setMobilePanel(mobilePanel === 'files' ? null : 'files');
            }}
          >
            文件
          </button>
          <button
            type="button"
            className="subtle-button mobile-only"
            onClick={() => {
              setInspectorTab('skills');
              setMobilePanel(mobilePanel === 'skills' ? null : 'skills');
            }}
          >
            Skill
          </button>
          <button type="button" className="subtle-button" onClick={onToggleTheme}>
            {themeMode === 'dark' ? '浅色' : '深色'}
          </button>
          <button type="button" className="subtle-button" onClick={onLogout} disabled={logoutPending}>
            退出
          </button>
        </div>
      </header>

      {pageError ? <div className="error-banner floating">{pageError}</div> : null}

      {hasActiveSession ? (
        <>
          <section className="message-stage">
            <div className="message-list" ref={messageListRef}>
              {stream.recovery ? (
                <div className="notice-card">
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
                      <div className="empty-state-actions">
                        {emptyStateStarterCaption ? (
                          <div className="empty-state-caption">{emptyStateStarterCaption}</div>
                        ) : null}
                        <div className="empty-state-suggestions">
                          {emptyStateStarterPrompts.map((prompt) => (
                            <button
                              key={prompt}
                              type="button"
                              className="empty-state-suggestion"
                              onClick={() => handleEmptyStatePromptClick(prompt)}
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
              {timeline.map((event) => (
                <MessageItem
                  key={event.id}
                  event={event}
                  onDownload={(file) => downloadMutation.mutate(file)}
                  onReuseImage={handleReuseImage}
                  downloading={downloadMutation.isPending}
                  canExpandToolTrace={user.role === 'admin'}
                />
              ))}
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
                  onDownload={(file) => downloadMutation.mutate(file)}
                  onReuseImage={handleReuseImage}
                  downloading={downloadMutation.isPending}
                  canExpandToolTrace={user.role === 'admin'}
                />
              ) : null}
              {thinkingEvent ? (
                <MessageItem
                  key={thinkingEvent.id}
                  event={thinkingEvent}
                  onDownload={(file) => downloadMutation.mutate(file)}
                  onReuseImage={handleReuseImage}
                  downloading={downloadMutation.isPending}
                  canExpandToolTrace={user.role === 'admin'}
                />
              ) : null}
            </div>
          </section>

          <footer
            className="composer"
            style={{
              paddingBottom: `calc(14px + env(safe-area-inset-bottom) + ${keyboardInset}px)`,
            }}
          >
            {stream.followUpQueue.length > 0 ? (
              <div className="runtime-preview-stack">
                <div className="runtime-preview-card is-queued">
                  <div className="status-label">待处理队列（按顺序处理）</div>
                  <ol className="runtime-preview-list">
                    {stream.followUpQueue.map((input, index) => (
                      <li key={`follow-up-input-${input.inputId}`} className="runtime-preview-list-item">
                        <div className="runtime-preview-list-row">
                          <span className="runtime-preview-index">{index + 1}</span>{' '}
                          <span className="runtime-preview-list-content">{input.content}</span>
                          <button
                            type="button"
                            className="runtime-preview-remove"
                            onClick={() => removeFollowUpInputMutation.mutate(input.inputId)}
                            disabled={removeFollowUpInputMutation.isPending}
                            aria-label={`取消待处理项：${input.content}`}
                            title="取消这条待处理输入"
                          >
                            ×
                          </button>
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>
            ) : null}

            <div className="composer-shell">
              {composerAttachments.length > 0 ? (
                <div className="composer-attachments" aria-live="polite">
                  {composerAttachments.map((attachment) => (
                    <div
                      key={attachment.localId}
                      className={`composer-attachment-chip is-${attachment.status}`}
                    >
                      <div className="composer-attachment-name">{attachment.displayName}</div>
                      <div className="composer-attachment-meta">
                        {attachment.status === 'uploading'
                          ? '上传中...'
                          : `${attachment.mimeType?.startsWith('image/') ? '图片附件' : '已附加'} · ${formatBytes(attachment.size)}`}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
              <label className="sr-only" htmlFor="chat-composer-input">
                聊天输入框
              </label>
              <textarea
                id="chat-composer-input"
                className="composer-textarea"
                ref={composerTextareaRef}
                value={draft}
                onChange={(event) => activeSessionId && setDraft(activeSessionId, event.target.value)}
                onPaste={handleComposerPaste}
                placeholder={isTurnRunning ? '继续补充信息，系统会按顺序处理' : '给 SkillChat 发送消息'}
                rows={3}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && window.innerWidth >= 900) {
                    event.preventDefault();
                    handleSend();
                  }
                }}
              />
              <div className="composer-footer">
                <div className="composer-status">
                  {hasUploadingAttachments ? <span>附件上传中...</span> : null}
                  {!hasUploadingAttachments && isTurnRunning ? <span>当前轮处理中</span> : null}
                </div>
                <div className="composer-actions">
                  {isTurnRunning ? (
                    <button
                      type="button"
                      className="composer-icon-button is-warning"
                      aria-label={interruptMutation.isPending ? '中断中...' : '中断当前 turn'}
                      title={interruptMutation.isPending ? '中断中...' : '中断当前 turn'}
                      onClick={() => interruptMutation.mutate()}
                      disabled={interruptMutation.isPending}
                    >
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" />
                      </svg>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="composer-icon-button"
                    aria-label={hasUploadingAttachments ? '附件上传中' : '上传附件'}
                    title={hasUploadingAttachments ? '附件上传中' : '上传附件'}
                    onClick={() => uploadInputRef.current?.click()}
                    disabled={!activeSessionId || hasUploadingAttachments}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M15.5 6.5 8.4 13.6a3 3 0 1 0 4.2 4.2l7.1-7.1a5 5 0 1 0-7.1-7.1L5.8 10.4"
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="1.8"
                      />
                    </svg>
                  </button>
                  <button
                    type="button"
                    className="composer-send-button"
                    onClick={handleSend}
                    aria-label={
                      sendMessageMutation.isPending ? '提交中...' : isTurnRunning ? '补充信息' : '发送'
                    }
                    title={
                      sendMessageMutation.isPending ? '提交中...' : isTurnRunning ? '补充信息' : '发送'
                    }
                    disabled={
                      !draft.trim() ||
                      hasUploadingAttachments ||
                      sendMessageMutation.isPending ||
                      interruptMutation.isPending
                    }
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M12 5v14M12 5l-5.5 5.5M12 5l5.5 5.5"
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                      />
                    </svg>
                  </button>
                </div>
              </div>
              <input
                ref={uploadInputRef}
                type="file"
                hidden
                multiple
                onChange={handleComposerFileSelection}
              />
            </div>
          </footer>
        </>
      ) : (
        <section className="message-stage">
          <div className="message-list">
            <EmptyState
              title="还没有会话"
              detail="先创建一个会话，并明确选择这个会话允许使用哪些 skill。未选择的 skill 不会进入上下文，也不可调用。"
              action={
                <div className="empty-state-actions">
                  <button type="button" className="primary-button" onClick={openCreateSessionDialog}>
                    新建会话
                  </button>
                  <div className="empty-state-caption">
                    会话创建后，你仍然可以在右侧面板调整当前会话启用的 skill 范围。
                  </div>
                </div>
              }
            />
          </div>
        </section>
      )}
    </main>
  );
};

export default ChatPage;
