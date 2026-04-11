import type { FormEvent, ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  loginSchema,
  registerSchema,
  type FileRecord,
  type SessionSummary,
  type SkillMetadata,
  type StoredEvent,
} from '@skillchat/shared';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from './lib/api';
import { MessageItem } from './components/MessageItem';
import { useAuthStore } from './stores/auth-store';
import { useUiStore } from './stores/ui-store';
import { useSessionStream } from './hooks/useSessionStream';
import { cn, formatBytes, groupBy, isWechatBrowser } from './lib/utils';
import { buildRenderableTimeline, type TimelineItem } from './lib/timeline';

const firstIssueMessage = (issues: Array<{ message: string }>) => issues[0]?.message ?? '输入不合法';

const AuthCard = ({
  title,
  subtitle,
  fields,
  submitText,
  onSubmit,
  footer,
  error,
  loading,
}: {
  title: string;
  subtitle: string;
  fields: Array<{ name: string; label: string; type?: string; value: string; onChange: (value: string) => void }>;
  submitText: string;
  onSubmit: (event: FormEvent) => void;
  footer: ReactNode;
  error: string | null;
  loading: boolean;
}) => (
  <div className="auth-page">
    <div className="auth-backdrop" />
    <form className="auth-card" onSubmit={onSubmit}>
      <div className="eyebrow">Skill Driven Workspace</div>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      <div className="auth-fields">
        {fields.map((field) => (
          <label key={field.name} className="field-group">
            <span>{field.label}</span>
            <input
              name={field.name}
              type={field.type ?? 'text'}
              value={field.value}
              onChange={(event) => field.onChange(event.target.value)}
              autoComplete={field.name}
            />
          </label>
        ))}
      </div>
      {error ? <div className="error-banner">{error}</div> : null}
      <button type="submit" className="primary-button" disabled={loading}>
        {loading ? '提交中...' : submitText}
      </button>
      <div className="auth-footer">{footer}</div>
    </form>
  </div>
);

const LoginPage = () => {
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => api.login({ username, password }),
    onSuccess: (payload) => {
      setAuth(payload);
      navigate('/app', { replace: true });
    },
    onError: (mutationError) => {
      setError(mutationError instanceof ApiError ? mutationError.message : '登录失败');
    },
  });

  return (
    <AuthCard
      title="登录 SkillChat"
      subtitle="在微信或桌面浏览器里，通过对话直接生成 PDF、Excel 和 Word 文件。"
      error={error}
      loading={mutation.isPending}
      fields={[
        { name: 'username', label: '用户名', value: username, onChange: setUsername },
        { name: 'password', label: '密码', type: 'password', value: password, onChange: setPassword },
      ]}
      submitText="登录"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        const validation = loginSchema.safeParse({ username, password });
        if (!validation.success) {
          setError(firstIssueMessage(validation.error.issues));
          return;
        }
        setError(null);
        mutation.mutate();
      }}
      footer={
        <button type="button" className="text-button" onClick={() => navigate('/register')}>
          还没有账号？去注册
        </button>
      }
    />
  );
};

const RegisterPage = () => {
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => api.register({ username, password, inviteCode }),
    onSuccess: (payload) => {
      setAuth(payload);
      navigate('/app', { replace: true });
    },
    onError: (mutationError) => {
      setError(mutationError instanceof ApiError ? mutationError.message : '注册失败');
    },
  });

  return (
    <AuthCard
      title="注册 SkillChat"
      subtitle="使用邀请码完成注册。V0.1 采用轻量鉴权，不依赖微信 OAuth。"
      error={error}
      loading={mutation.isPending}
      fields={[
        { name: 'username', label: '用户名', value: username, onChange: setUsername },
        { name: 'password', label: '密码', type: 'password', value: password, onChange: setPassword },
        { name: 'inviteCode', label: '邀请码', value: inviteCode, onChange: setInviteCode },
      ]}
      submitText="注册并进入"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        const validation = registerSchema.safeParse({ username, password, inviteCode });
        if (!validation.success) {
          setError(firstIssueMessage(validation.error.issues));
          return;
        }
        setError(null);
        mutation.mutate();
      }}
      footer={
        <button type="button" className="text-button" onClick={() => navigate('/login')}>
          已有账号？去登录
        </button>
      }
    />
  );
};

const EmptyState = ({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) => (
  <div className="empty-state">
    <h3>{title}</h3>
    <p>{detail}</p>
    {action}
  </div>
);

const SessionWorkspace = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { sessionId } = useParams();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const setActiveSessionId = useUiStore((state) => state.setActiveSessionId);
  const activeSessionId = sessionId ?? null;
  const mobilePanel = useUiStore((state) => state.mobilePanel);
  const setMobilePanel = useUiStore((state) => state.setMobilePanel);
  const drafts = useUiStore((state) => state.drafts);
  const setDraft = useUiStore((state) => state.setDraft);
  const clearStreamContent = useUiStore((state) => state.clearStreamContent);
  const stream = useSessionStream(activeSessionId);
  const [inspectorTab, setInspectorTab] = useState<'files' | 'skills'>('files');
  const [pageError, setPageError] = useState<string | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [keyboardInset, setKeyboardInset] = useState(0);

  useEffect(() => {
    setActiveSessionId(activeSessionId);
  }, [activeSessionId, setActiveSessionId]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) {
      return;
    }

    const viewport = window.visualViewport;
    const handleResize = () => {
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      setKeyboardInset(inset);
    };

    handleResize();
    viewport.addEventListener('resize', handleResize);
    viewport.addEventListener('scroll', handleResize);

    return () => {
      viewport.removeEventListener('resize', handleResize);
      viewport.removeEventListener('scroll', handleResize);
    };
  }, []);

  const sessionsQuery = useQuery({
    queryKey: ['sessions'],
    queryFn: api.listSessions,
  });

  const activeSession = useMemo(
    () => sessionsQuery.data?.find((item) => item.id === activeSessionId) ?? null,
    [activeSessionId, sessionsQuery.data],
  );

  const createSessionMutation = useMutation({
    mutationFn: () => api.createSession(),
    onSuccess: (session) => {
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      navigate(`/app/session/${session.id}`, { replace: true });
    },
    onError: (error) => setPageError(error instanceof ApiError ? error.message : '创建会话失败'),
  });

  const updateSessionMutation = useMutation({
    mutationFn: (payload: { sessionId: string; activeSkills: string[] }) => api.updateSession(payload.sessionId, {
      activeSkills: payload.activeSkills,
    }),
    onSuccess: async (session) => {
      await queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.setQueryData<SessionSummary[] | undefined>(['sessions'], (current) => current?.map((item) => (
        item.id === session.id ? session : item
      )));
    },
    onError: (error) => setPageError(error instanceof ApiError ? error.message : '更新会话失败'),
  });

  useEffect(() => {
    if (!sessionsQuery.isSuccess || location.pathname.startsWith('/login') || location.pathname.startsWith('/register')) {
      return;
    }

    if (!activeSessionId) {
      if (sessionsQuery.data.length > 0) {
        navigate(`/app/session/${sessionsQuery.data[0].id}`, { replace: true });
      } else if (!createSessionMutation.isPending) {
        createSessionMutation.mutate();
      }
    }
  }, [activeSessionId, createSessionMutation, location.pathname, navigate, sessionsQuery.data, sessionsQuery.isSuccess]);

  const messagesQuery = useQuery({
    queryKey: ['messages', activeSessionId],
    queryFn: () => api.listMessages(activeSessionId!),
    enabled: Boolean(activeSessionId),
  });

  const filesQuery = useQuery({
    queryKey: ['files', activeSessionId],
    queryFn: () => api.listFiles({ sessionId: activeSessionId! }),
    enabled: Boolean(activeSessionId),
  });

  const skillsQuery = useQuery({
    queryKey: ['skills'],
    queryFn: api.listSkills,
  });

  const sendMessageMutation = useMutation({
    mutationFn: (content: string) => api.sendMessage(activeSessionId!, content),
    onMutate: async (content) => {
      if (activeSessionId) {
        clearStreamContent(activeSessionId);
        const previous = queryClient.getQueryData<StoredEvent[]>(['messages', activeSessionId]) ?? [];
        queryClient.setQueryData<StoredEvent[]>(['messages', activeSessionId], [
          ...previous,
          {
            id: `optimistic-${Date.now()}`,
            sessionId: activeSessionId,
            kind: 'message',
            role: 'user',
            type: 'text',
            content,
            createdAt: new Date().toISOString(),
          },
        ]);
        return { previous };
      }
      return { previous: [] as StoredEvent[] };
    },
    onError: (error, _variables, context) => {
      if (activeSessionId && context?.previous) {
        queryClient.setQueryData(['messages', activeSessionId], context.previous);
      }
      setPageError(error instanceof ApiError ? error.message : '发送消息失败');
    },
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => api.uploadFile(activeSessionId!, file),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['files', activeSessionId] }),
        queryClient.invalidateQueries({ queryKey: ['messages', activeSessionId] }),
      ]);
    },
    onError: (error) => setPageError(error instanceof ApiError ? error.message : '上传失败'),
  });

  const shareMutation = useMutation({
    mutationFn: (fileId: string) => api.shareFile(fileId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['files', activeSessionId] });
    },
    onError: (error) => setPageError(error instanceof ApiError ? error.message : '共享失败'),
  });

  const downloadMutation = useMutation({
    mutationFn: (file: FileRecord) => api.downloadFile(file),
    onError: (error) => setPageError(error instanceof ApiError ? error.message : '下载失败'),
  });

  const { items: timeline, activeThinking } = useMemo<{
    items: TimelineItem[];
    activeThinking?: Extract<StoredEvent, { kind: 'thinking' }>;
  }>(
    () => buildRenderableTimeline([
      ...(messagesQuery.data ?? []),
      ...stream.transientEvents,
    ]),
    [messagesQuery.data, stream.transientEvents],
  );

  useEffect(() => {
    const target = messageListRef.current;
    if (!target) {
      return;
    }
    target.scrollTop = target.scrollHeight;
  }, [timeline, activeThinking, stream.pendingText, activeSessionId]);

  const draft = activeSessionId ? drafts[activeSessionId] ?? '' : '';
  const groupedFiles = useMemo(
    () => groupBy(filesQuery.data ?? [], (file) => file.bucket),
    [filesQuery.data],
  );
  const activeSkills = activeSession?.activeSkills ?? [];
  const isWechat = isWechatBrowser();

  const handleSend = () => {
    if (!activeSessionId || !draft.trim() || sendMessageMutation.isPending) {
      return;
    }
    const value = draft.trim();
    setDraft(activeSessionId, '');
    setPageError(null);
    sendMessageMutation.mutate(value);
  };

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="shell">
      <aside className={cn('side-panel sessions-panel', mobilePanel === 'sessions' && 'mobile-open')}>
        <div className="panel-header">
          <div>
            <div className="eyebrow">Sessions</div>
            <h2>会话</h2>
          </div>
          <button type="button" className="subtle-button" onClick={() => createSessionMutation.mutate()}>
            新建
          </button>
        </div>

        <div className="session-list">
          {(sessionsQuery.data ?? []).map((session: SessionSummary) => (
            <button
              key={session.id}
              type="button"
              className={cn('session-item', session.id === activeSessionId && 'active')}
              onClick={() => {
                navigate(`/app/session/${session.id}`);
                setMobilePanel(null);
              }}
            >
              <strong>{session.title}</strong>
              {session.activeSkills.length > 0 ? (
                <div className="session-active-skills">
                  {session.activeSkills.join(' · ')}
                </div>
              ) : null}
              <span>{new Date(session.updatedAt).toLocaleString()}</span>
            </button>
          ))}
        </div>
      </aside>

      <main className="workspace">
        <header className="workspace-header">
          <div>
            <div className="eyebrow">SkillChat</div>
            <h1>{activeSession?.title ?? 'SkillChat Workspace'}</h1>
            <p>
              当前用户：{user.username} · 连接状态：
              <span className={cn('stream-pill', `is-${stream.status}`)}>{stream.status}</span>
            </p>
            {activeSkills.length > 0 ? (
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
            <button type="button" className="subtle-button mobile-only" onClick={() => setMobilePanel(mobilePanel === 'sessions' ? null : 'sessions')}>
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
            <button type="button" className="subtle-button" onClick={() => logout()}>
              退出
            </button>
          </div>
        </header>

        {pageError ? <div className="error-banner floating">{pageError}</div> : null}

        <section className="message-stage">
          <div className="message-list" ref={messageListRef}>
            {timeline.length === 0 && !stream.pendingText ? (
              <EmptyState
                title="开始一个任务"
                detail="可以直接说“帮我生成一份本周销售报告 PDF”，也可以先上传 CSV、Markdown 或文本文件。"
              />
            ) : null}
            {timeline.map((event) => (
              <MessageItem
                key={event.id}
                event={event}
                onDownload={(file) => downloadMutation.mutate(file)}
                downloading={downloadMutation.isPending}
              />
            ))}
            {stream.pendingText ? (
              <MessageItem
                event={{ kind: 'pending_text', content: stream.pendingText }}
                onDownload={(file) => downloadMutation.mutate(file)}
                downloading={downloadMutation.isPending}
              />
            ) : null}
            {activeThinking ? (
              <MessageItem
                key={activeThinking.id}
                event={activeThinking}
                onDownload={(file) => downloadMutation.mutate(file)}
                downloading={downloadMutation.isPending}
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
          <div className="composer-tools">
            <button type="button" className="subtle-button" onClick={() => uploadInputRef.current?.click()} disabled={!activeSessionId || uploadMutation.isPending}>
              {uploadMutation.isPending ? '上传中...' : '上传文件'}
            </button>
            <input
              ref={uploadInputRef}
              type="file"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file && activeSessionId) {
                  uploadMutation.mutate(file);
                }
                event.currentTarget.value = '';
              }}
            />
            <span className="composer-hint">微信内建议使用 16px 以上字体输入，避免页面缩放。</span>
          </div>

          <div className="composer-box">
            <textarea
              value={draft}
              onChange={(event) => activeSessionId && setDraft(activeSessionId, event.target.value)}
              placeholder="输入你的需求，例如：把上传的 CSV 生成 Excel 并加上柱状图"
              rows={3}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && window.innerWidth >= 900) {
                  event.preventDefault();
                  handleSend();
                }
              }}
            />
            <button type="button" className="primary-button" onClick={handleSend} disabled={!draft.trim() || sendMessageMutation.isPending}>
              {sendMessageMutation.isPending ? '处理中...' : '发送'}
            </button>
          </div>
        </footer>
      </main>

      <aside className={cn('side-panel inspector-panel', mobilePanel && mobilePanel !== 'sessions' && 'mobile-open')}>
        <div className="panel-header">
          <div className="tabs">
            <button
              type="button"
              className={cn('tab-button', inspectorTab === 'files' && 'active')}
              onClick={() => setInspectorTab('files')}
            >
              文件
            </button>
            <button
              type="button"
              className={cn('tab-button', inspectorTab === 'skills' && 'active')}
              onClick={() => setInspectorTab('skills')}
            >
              Skill
            </button>
          </div>
        </div>

        {inspectorTab === 'files' ? (
          <div className="panel-section">
            {isWechat ? (
              <div className="notice-card">微信内若下载受限，请点击文件后在系统浏览器中打开或使用桌面端下载。</div>
            ) : null}
            {(['uploads', 'outputs', 'shared'] as const).map((bucket) => (
              <section key={bucket} className="file-group">
                <h3>{bucket}</h3>
                {(groupedFiles[bucket] ?? []).length === 0 ? (
                  <div className="inline-empty">暂无文件</div>
                ) : (
                  (groupedFiles[bucket] ?? []).map((file) => (
                    <article key={file.id} className="file-card">
                      <div>
                        <div className="file-name">{file.displayName}</div>
                        <div className="file-meta">{file.mimeType ?? 'application/octet-stream'} · {formatBytes(file.size)}</div>
                      </div>
                      <div className="file-actions">
                        <button type="button" className="subtle-button" onClick={() => downloadMutation.mutate(file)}>
                          下载
                        </button>
                        {bucket !== 'shared' ? (
                          <button
                            type="button"
                            className="subtle-button"
                            onClick={() => shareMutation.mutate(file.id)}
                            disabled={shareMutation.isPending}
                          >
                            共享
                          </button>
                        ) : null}
                      </div>
                    </article>
                  ))
                )}
              </section>
            ))}
          </div>
        ) : (
          <div className="panel-section">
            {(skillsQuery.data ?? []).map((skill: SkillMetadata) => (
              <article key={skill.name} className="skill-card">
                <div className="skill-card-header">
                  <div className="skill-title">{skill.name}</div>
                  {activeSessionId ? (
                    <button
                      type="button"
                      className={cn('subtle-button', activeSkills.includes(skill.name) && 'is-active-skill')}
                      disabled={updateSessionMutation.isPending}
                      onClick={() => {
                        const nextSkills = activeSkills.includes(skill.name)
                          ? activeSkills.filter((item) => item !== skill.name)
                          : [...activeSkills, skill.name];
                        updateSessionMutation.mutate({
                          sessionId: activeSessionId,
                          activeSkills: nextSkills,
                        });
                      }}
                    >
                      {activeSkills.includes(skill.name) ? '已激活' : '激活'}
                    </button>
                  ) : null}
                </div>
                <p>{skill.description}</p>
                <div className="skill-meta">
                  <span>{skill.runtime}</span>
                  <span>{skill.timeoutSec}s</span>
                </div>
              </article>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
};

const ProtectedRoute = ({ children }: { children: ReactNode }) => {
  const token = useAuthStore((state) => state.token);
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
};

const App = () => (
  <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route path="/register" element={<RegisterPage />} />
    <Route
      path="/app"
      element={(
        <ProtectedRoute>
          <SessionWorkspace />
        </ProtectedRoute>
      )}
    />
    <Route
      path="/app/session/:sessionId"
      element={(
        <ProtectedRoute>
          <SessionWorkspace />
        </ProtectedRoute>
      )}
    />
    <Route path="*" element={<Navigate to="/app" replace />} />
  </Routes>
);

export default App;
