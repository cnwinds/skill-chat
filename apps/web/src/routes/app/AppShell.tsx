import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  createSessionSchema,
  type FileRecord,
  type SessionSummary,
} from '@skillchat/shared';
import { ApiError, api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';
import { applyThemeMode, usePreferencesStore } from '@/stores/preferences-store';
import { groupBy, isWechatBrowser } from '@/lib/utils';
import { composerAttachmentsActions } from '@/hooks/useComposerAttachments';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Toaster, toast } from '@/components/ui/toaster';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { NewSessionDialog } from '@/components/sidebar/NewSessionDialog';
import { InspectorPanel } from '@/components/inspector/InspectorPanel';
import { ImageLightbox } from '@/components/ImageLightbox';
import { cn } from '@/lib/cn';
import type { AppShellOutletValue } from './AppShellContext';

const firstIssueMessage = (issues: Array<{ message: string }>) => issues[0]?.message ?? '输入不合法';

const notifyError = (message: string | null) => {
  if (!message) {
    return;
  }
  toast({ title: '出错了', description: message, variant: 'destructive' });
};

export const AppShell = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { sessionId } = useParams();
  const activeSessionId = sessionId ?? null;
  const isSettingsView = location.pathname === '/app/settings';
  const isDesktop = useIsDesktop();

  const user = useAuthStore((state) => state.user);
  const setAnonymous = useAuthStore((state) => state.setAnonymous);
  const setActiveSessionId = useUiStore((state) => state.setActiveSessionId);
  const themeMode = usePreferencesStore((state) => state.themeMode);
  const setThemeMode = usePreferencesStore((state) => state.setThemeMode);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [visibleSessionCount, setVisibleSessionCount] = useState(5);
  const [isCreateSessionOpen, setIsCreateSessionOpen] = useState(false);
  const [newSessionTitle, setNewSessionTitle] = useState('');
  const [newSessionSkills, setNewSessionSkills] = useState<string[]>([]);
  const [inspectorTab, setInspectorTab] = useState<'files' | 'skills'>('files');

  useEffect(() => {
    setActiveSessionId(activeSessionId);
  }, [activeSessionId, setActiveSessionId]);

  useEffect(() => {
    composerAttachmentsActions.clearAll();
  }, []);

  // Close sheets when transitioning to desktop so they don't linger.
  useEffect(() => {
    if (isDesktop) {
      setSidebarOpen(false);
      setInspectorOpen(false);
    }
  }, [isDesktop]);

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
    onError: (error) => notifyError(error instanceof ApiError ? error.message : '更新个人设置失败'),
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
        sessionScrollStates: {},
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
    onError: (error) => notifyError(error instanceof ApiError ? error.message : '创建会话失败'),
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
    onError: (error) => notifyError(error instanceof ApiError ? error.message : '更新会话失败'),
  });

  const shareMutation = useMutation({
    mutationFn: (fileId: string) => api.shareFile(fileId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['files', activeSessionId] });
    },
    onError: (error) => notifyError(error instanceof ApiError ? error.message : '共享失败'),
  });

  const downloadMutation = useMutation({
    mutationFn: (file: FileRecord) => api.downloadFile(file),
    onError: (error) => notifyError(error instanceof ApiError ? error.message : '下载失败'),
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
  const sessions = sessionsQuery.data ?? [];
  const hiddenSessionCount = Math.max(0, sessions.length - visibleSessionCount);
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
    setIsCreateSessionOpen(true);
  };

  const handleCreateSession = () => {
    const validation = createSessionSchema.safeParse({
      title: newSessionTitle.trim() ? newSessionTitle.trim() : undefined,
      activeSkills: newSessionSkills,
    });
    if (!validation.success) {
      notifyError(firstIssueMessage(validation.error.issues));
      return;
    }
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

  const handleSelectSession = (id: string) => {
    navigate(`/app/session/${id}`);
    setSidebarOpen(false);
  };

  const handleSelectSettings = () => {
    navigate('/app/settings');
    setSidebarOpen(false);
  };

  const handleToggleSkill = (skillName: string) => {
    if (!activeSessionId) {
      return;
    }
    const nextSkills = activeSkills.includes(skillName)
      ? activeSkills.filter((item) => item !== skillName)
      : [...activeSkills, skillName];
    updateSessionMutation.mutate({ sessionId: activeSessionId, activeSkills: nextSkills });
  };

  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (isSettingsView && user.role !== 'admin') {
    return <Navigate to="/app" replace />;
  }

  const outletValue: AppShellOutletValue = {
    setPageError: notifyError,
    openCreateSessionDialog,
    openSidebarSheet: () => setSidebarOpen(true),
    openInspectorSheet: (tab) => {
      setInspectorTab(tab);
      setInspectorOpen(true);
    },
    themeMode,
    onToggleTheme: () =>
      updateMySettingsMutation.mutate({ themeMode: themeMode === 'dark' ? 'light' : 'dark' }),
    onLogout: () => logoutMutation.mutate(),
    logoutPending: logoutMutation.isPending,
  };

  const showInspector = !isSettingsView;

  const sidebarNode = (
    <Sidebar
      sessions={sessions}
      visibleSessionCount={visibleSessionCount}
      hiddenSessionCount={hiddenSessionCount}
      activeSessionId={activeSessionId}
      isSettingsView={isSettingsView}
      showSettingsEntry={user.role === 'admin'}
      onSelectSession={handleSelectSession}
      onSelectSettings={handleSelectSettings}
      onCreateSession={openCreateSessionDialog}
      onLoadMoreSessions={() => setVisibleSessionCount((current) => current + 5)}
    />
  );

  const inspectorNode = showInspector ? (
    <InspectorPanel
      inspectorTab={inspectorTab}
      onTabChange={setInspectorTab}
      hasActiveSession={hasActiveSession}
      isWechat={isWechat}
      groupedFiles={groupedFiles}
      installedSkills={installedSkills}
      activeSkills={activeSkills}
      onDownloadFile={(file) => downloadMutation.mutate(file)}
      onShareFile={(fileId) => shareMutation.mutate(fileId)}
      onReuseImage={handleReuseImage}
      onToggleSkill={handleToggleSkill}
      toggleDisabled={updateSessionMutation.isPending}
      sharePending={shareMutation.isPending}
    />
  ) : null;

  return (
    <div
      className={cn(
        'flex h-dvh w-full bg-background text-foreground',
      )}
    >
      {/* Desktop sidebar (persistent on lg+) */}
      <aside className="hidden h-full w-[260px] shrink-0 border-r border-border lg:block">
        {sidebarNode}
      </aside>

      {/* Center column */}
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <Outlet context={outletValue} />
      </div>

      {/* Desktop inspector (persistent on lg+, hidden in settings) */}
      {showInspector ? (
        <aside className="hidden h-full w-[320px] shrink-0 border-l border-border lg:block">
          {inspectorNode}
        </aside>
      ) : null}

      {/* Mobile sidebar drawer */}
      <Sheet open={sidebarOpen && !isDesktop} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="p-0 lg:hidden">
          {sidebarNode}
        </SheetContent>
      </Sheet>

      {/* Mobile inspector drawer */}
      {showInspector ? (
        <Sheet open={inspectorOpen && !isDesktop} onOpenChange={setInspectorOpen}>
          <SheetContent side="right" className="p-0 lg:hidden">
            {inspectorNode}
          </SheetContent>
        </Sheet>
      ) : null}

      <NewSessionDialog
        open={isCreateSessionOpen}
        title={newSessionTitle}
        selectedSkills={newSessionSkills}
        skills={installedSkills}
        loading={createSessionMutation.isPending}
        onOpenChange={setIsCreateSessionOpen}
        onTitleChange={setNewSessionTitle}
        onToggleSkill={toggleNewSessionSkill}
        onSubmit={handleCreateSession}
      />

      <Toaster />
      <ImageLightbox />
    </div>
  );
};

export default AppShell;
