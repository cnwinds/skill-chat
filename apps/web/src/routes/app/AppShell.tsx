import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  createSessionSchema,
  type FileRecord,
  type SessionSummary,
  type SkillMetadata,
} from '@skillchat/shared';
import { ApiError, api } from '@/lib/api';
import { SkillCard } from '@/components/SkillCard';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';
import { applyThemeMode, usePreferencesStore } from '@/stores/preferences-store';
import { cn, formatBytes, groupBy, isWechatBrowser } from '@/lib/utils';
import { composerAttachmentsActions } from '@/hooks/useComposerAttachments';
import type { AppShellOutletValue } from './AppShellContext';

const firstIssueMessage = (issues: Array<{ message: string }>) => issues[0]?.message ?? '输入不合法';

interface CreateSessionDialogProps {
  open: boolean;
  title: string;
  selectedSkills: string[];
  skills: SkillMetadata[];
  loading: boolean;
  onTitleChange: (value: string) => void;
  onToggleSkill: (skillName: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}

const CreateSessionDialog = ({
  open,
  title,
  selectedSkills,
  skills,
  loading,
  onTitleChange,
  onToggleSkill,
  onClose,
  onSubmit,
}: CreateSessionDialogProps) => {
  if (!open) {
    return null;
  }

  return (
    <div className="dialog-overlay" role="presentation" onClick={onClose}>
      <div
        className="dialog-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-session-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-header">
          <div>
            <div className="eyebrow">Session Scope</div>
            <h2 id="create-session-title">新建会话</h2>
            <p>项目里可以安装很多 skill，但只有你现在选中的这些，才会进入本会话上下文并允许调用。</p>
          </div>
          <button type="button" className="subtle-button" onClick={onClose}>
            关闭
          </button>
        </div>

        <div className="dialog-body">
          <label className="field-group">
            <span>会话标题</span>
            <input
              value={title}
              onChange={(event) => onTitleChange(event.target.value)}
              placeholder="可选，不填则自动使用“新会话”"
            />
          </label>

          <div className="settings-stack">
            <div>
              <strong>为当前会话选择可用 Skills</strong>
              <div className="panel-caption">未选择的 skill 不会进入模型上下文，也不允许读取或执行。</div>
            </div>
            <div className="skill-picker-grid">
              {skills.map((skill) => (
                <SkillCard
                  key={skill.name}
                  skill={skill}
                  selected={selectedSkills.includes(skill.name)}
                  onToggle={() => onToggleSkill(skill.name)}
                />
              ))}
              {skills.length === 0 ? (
                <div className="inline-empty">项目中还没有可选的 skill。</div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="dialog-footer">
          <div className="panel-caption">
            {selectedSkills.length > 0
              ? `本次会话已选择：${selectedSkills.join(' · ')}`
              : '本次会话未启用任何 skill，将按普通对话和通用工具运行。'}
          </div>
          <button type="button" className="primary-button" disabled={loading} onClick={onSubmit}>
            {loading ? '创建中...' : '创建会话'}
          </button>
        </div>
      </div>
    </div>
  );
};

export const AppShell = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { sessionId } = useParams();
  const activeSessionId = sessionId ?? null;
  const isSettingsView = location.pathname === '/app/settings';

  const user = useAuthStore((state) => state.user);
  const setAnonymous = useAuthStore((state) => state.setAnonymous);
  const setActiveSessionId = useUiStore((state) => state.setActiveSessionId);
  const mobilePanel = useUiStore((state) => state.mobilePanel);
  const setMobilePanel = useUiStore((state) => state.setMobilePanel);
  const themeMode = usePreferencesStore((state) => state.themeMode);
  const setThemeMode = usePreferencesStore((state) => state.setThemeMode);

  const [pageError, setPageError] = useState<string | null>(null);
  const [visibleSessionCount, setVisibleSessionCount] = useState(5);
  const [isCreateSessionOpen, setIsCreateSessionOpen] = useState(false);
  const [newSessionTitle, setNewSessionTitle] = useState('');
  const [newSessionSkills, setNewSessionSkills] = useState<string[]>([]);
  const [inspectorTab, setInspectorTab] = useState<'files' | 'skills'>('files');

  useEffect(() => {
    setActiveSessionId(activeSessionId);
  }, [activeSessionId, setActiveSessionId]);

  // Drop any composer attachments left over from a previous shell mount
  // (e.g., logout/login cycles, or test renders) so per-session state
  // doesn't leak across users or runs.
  useEffect(() => {
    composerAttachmentsActions.clearAll();
  }, []);

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

  const filesQuery = useQuery({
    queryKey: ['files', activeSessionId],
    queryFn: () => api.listFiles({ sessionId: activeSessionId! }),
    enabled: Boolean(user && activeSessionId),
  });

  const mySettingsQuery = useQuery({
    queryKey: ['my-settings'],
    queryFn: api.getMySettings,
    enabled: Boolean(user),
  });

  useEffect(() => {
    if (mySettingsQuery.data?.themeMode) {
      setThemeMode(mySettingsQuery.data.themeMode);
    } else {
      applyThemeMode(themeMode);
    }
  }, [mySettingsQuery.data?.themeMode, setThemeMode, themeMode]);

  const updateMySettingsMutation = useMutation({
    mutationFn: api.updateMySettings,
    onSuccess: (payload) => {
      setThemeMode(payload.themeMode);
      queryClient.setQueryData(['my-settings'], payload);
    },
    onError: (error) => setPageError(error instanceof ApiError ? error.message : '更新个人设置失败'),
  });

  const logoutMutation = useMutation({
    mutationFn: api.logout,
    onSettled: async () => {
      setAnonymous();
      useUiStore.setState({
        activeSessionId: null,
        mobilePanel: null,
        drafts: {},
        streams: {},
      });
      queryClient.clear();
      navigate('/login', { replace: true });
    },
  });

  const createSessionMutation = useMutation({
    mutationFn: (payload: { title?: string; activeSkills?: string[] }) => api.createSession(payload),
    onSuccess: (session) => {
      setNewSessionTitle('');
      setNewSessionSkills([]);
      setIsCreateSessionOpen(false);
      queryClient.setQueryData<SessionSummary[] | undefined>(['sessions'], (current) => {
        const rest = (current ?? []).filter((item) => item.id !== session.id);
        return [session, ...rest];
      });
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      navigate(`/app/session/${session.id}`, { replace: true });
    },
    onError: (error) => setPageError(error instanceof ApiError ? error.message : '创建会话失败'),
  });

  const updateSessionMutation = useMutation({
    mutationFn: (payload: { sessionId: string; activeSkills: string[] }) =>
      api.updateSession(payload.sessionId, { activeSkills: payload.activeSkills }),
    onSuccess: async (session) => {
      await queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.setQueryData<SessionSummary[] | undefined>(['sessions'], (current) =>
        current?.map((item) => (item.id === session.id ? session : item)),
      );
    },
    onError: (error) => setPageError(error instanceof ApiError ? error.message : '更新会话失败'),
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

  useEffect(() => {
    if (!sessionsQuery.isSuccess || isSettingsView) {
      return;
    }

    if (!activeSessionId && sessionsQuery.data.length > 0) {
      navigate(`/app/session/${sessionsQuery.data[0].id}`, { replace: true });
      return;
    }

    if (activeSessionId && !sessionsQuery.data.some((session) => session.id === activeSessionId)) {
      if (sessionsQuery.data.length > 0) {
        navigate(`/app/session/${sessionsQuery.data[0].id}`, { replace: true });
      } else {
        navigate('/app', { replace: true });
      }
    }
  }, [activeSessionId, isSettingsView, navigate, sessionsQuery.data, sessionsQuery.isSuccess]);

  useEffect(() => {
    if (!sessionsQuery.data) {
      return;
    }
    setVisibleSessionCount((current) => {
      const nextMin = Math.min(5, sessionsQuery.data.length);
      return Math.max(current, nextMin);
    });
  }, [sessionsQuery.data]);

  const activeSession = useMemo(
    () => sessionsQuery.data?.find((item) => item.id === activeSessionId) ?? null,
    [activeSessionId, sessionsQuery.data],
  );
  const hasActiveSession = Boolean(activeSessionId && activeSession);
  const visibleSessions = useMemo(
    () => (sessionsQuery.data ?? []).slice(0, visibleSessionCount),
    [sessionsQuery.data, visibleSessionCount],
  );
  const hiddenSessionCount = Math.max(0, (sessionsQuery.data?.length ?? 0) - visibleSessionCount);
  const installedSkills = skillsQuery.data ?? [];
  const groupedFiles = useMemo(
    () => groupBy(filesQuery.data ?? [], (file) => file.bucket),
    [filesQuery.data],
  );
  const activeSkills = activeSession?.activeSkills ?? [];
  const isWechat = isWechatBrowser();

  const openCreateSessionDialog = () => {
    setNewSessionTitle('');
    setNewSessionSkills([]);
    setPageError(null);
    setIsCreateSessionOpen(true);
  };

  const handleCreateSession = () => {
    const validation = createSessionSchema.safeParse({
      title: newSessionTitle.trim() ? newSessionTitle.trim() : undefined,
      activeSkills: newSessionSkills,
    });
    if (!validation.success) {
      setPageError(firstIssueMessage(validation.error.issues));
      return;
    }
    setPageError(null);
    createSessionMutation.mutate(validation.data);
  };

  const toggleNewSessionSkill = (skillName: string) => {
    setNewSessionSkills((current) =>
      current.includes(skillName)
        ? current.filter((item) => item !== skillName)
        : [...current, skillName],
    );
  };

  const handleReuseImage = (file: FileRecord) => {
    if (!activeSessionId) {
      return;
    }
    composerAttachmentsActions.addFromFileRecord(activeSessionId, file);
  };

  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (isSettingsView && user.role !== 'admin') {
    return <Navigate to="/app" replace />;
  }

  const outletValue: AppShellOutletValue = {
    pageError,
    setPageError,
    openCreateSessionDialog,
    themeMode,
    onToggleTheme: () =>
      updateMySettingsMutation.mutate({ themeMode: themeMode === 'dark' ? 'light' : 'dark' }),
    onLogout: () => logoutMutation.mutate(),
    logoutPending: logoutMutation.isPending,
    setMobilePanel,
    mobilePanel,
    setInspectorTab,
  };

  return (
    <div className="shell">
      <aside
        className={cn('side-panel sessions-panel', mobilePanel === 'sessions' && 'mobile-open')}
      >
        <div className="panel-header">
          <div>
            <div className="eyebrow">Sessions</div>
            <h2>会话</h2>
          </div>
          <button type="button" className="subtle-button" onClick={openCreateSessionDialog}>
            新建
          </button>
        </div>

        <div className="session-list">
          {user.role === 'admin' ? (
            <button
              type="button"
              className={cn('session-item settings-entry', isSettingsView && 'active')}
              onClick={() => {
                navigate('/app/settings');
                setMobilePanel(null);
              }}
            >
              <strong>设置</strong>
              <span>系统配置 / 用户 / 邀请码</span>
            </button>
          ) : null}
          {visibleSessions.map((session: SessionSummary) => (
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
                <div className="session-active-skills">{session.activeSkills.join(' · ')}</div>
              ) : null}
              <span>{new Date(session.updatedAt).toLocaleString()}</span>
            </button>
          ))}
          {hiddenSessionCount > 0 ? (
            <button
              type="button"
              className="session-more-button"
              onClick={() => setVisibleSessionCount((current) => current + 5)}
            >
              更多会话（还有 {hiddenSessionCount} 条）
            </button>
          ) : null}
        </div>
      </aside>

      <Outlet context={outletValue} />

      {!isSettingsView ? (
        <aside
          className={cn(
            'side-panel inspector-panel',
            mobilePanel && mobilePanel !== 'sessions' && 'mobile-open',
          )}
        >
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
                <div className="notice-card">
                  微信内若下载受限，请点击文件后在系统浏览器中打开或使用桌面端下载。
                </div>
              ) : null}
              {!hasActiveSession ? (
                <div className="inline-empty">先进入一个会话，当前会话的文件才会显示在这里。</div>
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
                          <div className="file-meta">
                            {file.mimeType ?? 'application/octet-stream'} · {formatBytes(file.size)}
                          </div>
                        </div>
                        <div className="file-actions">
                          <button
                            type="button"
                            className="subtle-button"
                            onClick={() => downloadMutation.mutate(file)}
                          >
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
                          {file.mimeType?.startsWith('image/') && hasActiveSession ? (
                            <button
                              type="button"
                              className="subtle-button"
                              onClick={() => handleReuseImage(file)}
                            >
                              重用
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
              <div className="status-card muted">
                <strong>{hasActiveSession ? '当前会话 Skill 作用域' : '已安装 Skills'}</strong>
                <div className="file-meta">
                  {hasActiveSession
                    ? activeSkills.length > 0
                      ? `当前会话只允许使用这些 skills：${activeSkills.join(' · ')}。未启用的 skill 不会进入上下文，也不可调用。`
                      : '当前会话未启用任何 skill。未启用的 skill 不会进入上下文，也不可调用。'
                    : '项目中可以安装很多 skill，但只有加入当前会话的 skill 才会被读取、参考或执行。'}
                </div>
              </div>
              <div className="skill-library-grid">
                {installedSkills.map((skill: SkillMetadata) => (
                  <SkillCard
                    key={skill.name}
                    skill={skill}
                    selected={activeSkills.includes(skill.name)}
                    disabled={updateSessionMutation.isPending}
                    onToggle={
                      hasActiveSession
                        ? () => {
                            const nextSkills = activeSkills.includes(skill.name)
                              ? activeSkills.filter((item) => item !== skill.name)
                              : [...activeSkills, skill.name];
                            updateSessionMutation.mutate({
                              sessionId: activeSessionId!,
                              activeSkills: nextSkills,
                            });
                          }
                        : undefined
                    }
                  />
                ))}
              </div>
              {installedSkills.length === 0 ? (
                <div className="inline-empty">项目中还没有安装 skill。</div>
              ) : null}
            </div>
          )}
        </aside>
      ) : null}

      <CreateSessionDialog
        open={isCreateSessionOpen}
        title={newSessionTitle}
        selectedSkills={newSessionSkills}
        skills={installedSkills}
        loading={createSessionMutation.isPending}
        onTitleChange={setNewSessionTitle}
        onToggleSkill={toggleNewSessionSkill}
        onClose={() => setIsCreateSessionOpen(false)}
        onSubmit={handleCreateSession}
      />
    </div>
  );
};

export default AppShell;
