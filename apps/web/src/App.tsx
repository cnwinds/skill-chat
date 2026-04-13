import type { ChangeEvent, ClipboardEvent as ReactClipboardEvent, FormEvent, ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  bootstrapAdminSchema,
  createSessionSchema,
  loginSchema,
  registerRequestSchema,
  type AdminUserSummary,
  type FileRecord,
  type InviteCodeSummary,
  type SessionSummary,
  type SkillMetadata,
  type StoredEvent,
  type SystemSettings,
  type ThinkingEvent,
} from '@skillchat/shared';
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from './lib/api';
import { MessageItem } from './components/MessageItem';
import { useAuthStore } from './stores/auth-store';
import { useUiStore } from './stores/ui-store';
import { useSessionStream } from './hooks/useSessionStream';
import { cn, formatBytes, groupBy, isWechatBrowser } from './lib/utils';
import { buildRenderableTimeline, type TimelineItem } from './lib/timeline';
import { applyThemeMode, usePreferencesStore } from './stores/preferences-store';

const firstIssueMessage = (issues: Array<{ message: string }>) => issues[0]?.message ?? '输入不合法';

type ComposerAttachment = {
  localId: string;
  displayName: string;
  mimeType: string | null;
  size: number;
  status: 'uploading' | 'uploaded';
};

const createComposerAttachmentId = () => `attachment_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const normalizeAttachmentFile = (file: File, index: number) => {
  if (file.name.trim()) {
    return file;
  }

  const extension = file.type.startsWith('image/') ? file.type.replace('image/', '') || 'png' : 'bin';
  return new File(
    [file],
    `pasted-image-${Date.now()}-${index + 1}.${extension}`,
    {
      type: file.type || 'application/octet-stream',
      lastModified: Date.now(),
    },
  );
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
  const systemStatusQuery = useQuery({
    queryKey: ['system-status'],
    queryFn: api.getSystemStatus,
  });

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
        <>
          <button type="button" className="text-button" onClick={() => navigate('/register')}>
            还没有账号？去注册
          </button>
          {systemStatusQuery.data && !systemStatusQuery.data.initialized ? (
            <button type="button" className="text-button" onClick={() => navigate('/bootstrap-admin')}>
              首次启动？创建管理员
            </button>
          ) : null}
        </>
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
  const systemStatusQuery = useQuery({
    queryKey: ['system-status'],
    queryFn: api.getSystemStatus,
  });
  const requireInviteCode = systemStatusQuery.data?.registrationRequiresInviteCode ?? true;

  const mutation = useMutation({
    mutationFn: () => api.register({
      username,
      password,
      inviteCode: inviteCode.trim() ? inviteCode.trim() : undefined,
    }),
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
      subtitle={requireInviteCode
        ? '使用邀请码完成注册。V0.1 采用轻量鉴权，不依赖微信 OAuth。'
        : '当前已开放注册，不需要邀请码。'}
      error={error}
      loading={mutation.isPending}
      fields={[
        { name: 'username', label: '用户名', value: username, onChange: setUsername },
        { name: 'password', label: '密码', type: 'password', value: password, onChange: setPassword },
        ...(requireInviteCode
          ? [{ name: 'inviteCode', label: '邀请码', value: inviteCode, onChange: setInviteCode }]
          : []),
      ]}
      submitText="注册并进入"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        const validation = registerRequestSchema.safeParse({
          username,
          password,
          inviteCode: inviteCode.trim() ? inviteCode.trim() : undefined,
        });
        if (!validation.success) {
          setError(firstIssueMessage(validation.error.issues));
          return;
        }
        if (requireInviteCode && !inviteCode.trim()) {
          setError('请输入有效的邀请码');
          return;
        }
        setError(null);
        mutation.mutate();
      }}
      footer={
        <>
          <button type="button" className="text-button" onClick={() => navigate('/login')}>
            已有账号？去登录
          </button>
          {systemStatusQuery.data && !systemStatusQuery.data.initialized ? (
            <button type="button" className="text-button" onClick={() => navigate('/bootstrap-admin')}>
              首次启动？创建管理员
            </button>
          ) : null}
        </>
      }
    />
  );
};

const BootstrapAdminPage = () => {
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const systemStatusQuery = useQuery({
    queryKey: ['system-status'],
    queryFn: api.getSystemStatus,
  });

  const mutation = useMutation({
    mutationFn: () => api.bootstrapAdmin({ username, password }),
    onSuccess: (payload) => {
      setAuth(payload);
      navigate('/app', { replace: true });
    },
    onError: (mutationError) => {
      setError(mutationError instanceof ApiError ? mutationError.message : '初始化管理员失败');
    },
  });

  if (systemStatusQuery.data?.initialized) {
    return <Navigate to="/login" replace />;
  }

  return (
    <AuthCard
      title="初始化管理员"
      subtitle="系统首次启动时创建第一个管理员账号。创建成功后，该入口将自动关闭。"
      error={error}
      loading={mutation.isPending}
      fields={[
        { name: 'username', label: '管理员用户名', value: username, onChange: setUsername },
        { name: 'password', label: '密码', type: 'password', value: password, onChange: setPassword },
        { name: 'confirmPassword', label: '确认密码', type: 'password', value: confirmPassword, onChange: setConfirmPassword },
      ]}
      submitText="创建管理员并进入"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        const validation = bootstrapAdminSchema.safeParse({ username, password });
        if (!validation.success) {
          setError(firstIssueMessage(validation.error.issues));
          return;
        }
        if (password !== confirmPassword) {
          setError('两次输入的密码不一致');
          return;
        }
        setError(null);
        mutation.mutate();
      }}
      footer={
        <button type="button" className="text-button" onClick={() => navigate('/login')}>
          返回登录
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
}: {
  open: boolean;
  title: string;
  selectedSkills: string[];
  skills: SkillMetadata[];
  loading: boolean;
  onTitleChange: (value: string) => void;
  onToggleSkill: (skillName: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) => {
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
                <article key={skill.name} className="skill-card">
                  <div className="skill-card-header">
                    <div className="skill-title">{skill.name}</div>
                    <button
                      type="button"
                      className={cn('subtle-button', selectedSkills.includes(skill.name) && 'is-active-skill')}
                      onClick={() => onToggleSkill(skill.name)}
                    >
                      {selectedSkills.includes(skill.name) ? '本会话已启用' : '加入会话'}
                    </button>
                  </div>
                  <p>{skill.description}</p>
                </article>
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

const AdminSettingsView = ({
  pageError,
  setPageError,
}: {
  pageError: string | null;
  setPageError: (value: string | null) => void;
}) => {
  const queryClient = useQueryClient();
  const [settingsTab, setSettingsTab] = useState<'users' | 'system' | 'invites'>('users');
  const [inviteBatchCount, setInviteBatchCount] = useState('5');
  const [systemDraft, setSystemDraft] = useState<SystemSettings | null>(null);
  const settingsQuery = useQuery({
    queryKey: ['admin-system-settings'],
    queryFn: api.getAdminSystemSettings,
  });
  const usersQuery = useQuery({
    queryKey: ['admin-users'],
    queryFn: api.listAdminUsers,
  });
  const invitesQuery = useQuery({
    queryKey: ['admin-invites'],
    queryFn: api.listAdminInviteCodes,
  });

  const updateSettingsMutation = useMutation({
    mutationFn: (payload: Partial<SystemSettings>) => api.updateAdminSystemSettings(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-system-settings'] });
    },
    onError: (error) => setPageError(error instanceof ApiError ? error.message : '更新系统配置失败'),
  });

  const updateUserMutation = useMutation({
    mutationFn: ({ userId, payload }: { userId: string; payload: { role?: 'admin' | 'member'; status?: 'active' | 'disabled' } }) =>
      api.updateAdminUser(userId, payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-users'] });
    },
    onError: (error) => setPageError(error instanceof ApiError ? error.message : '更新用户失败'),
  });

  const createInvitesMutation = useMutation({
    mutationFn: (count: number) => api.createAdminInviteCodes(count),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-invites'] });
    },
    onError: (error) => setPageError(error instanceof ApiError ? error.message : '创建邀请码失败'),
  });

  const deleteInviteMutation = useMutation({
    mutationFn: (code: string) => api.deleteAdminInviteCode(code),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-invites'] });
    },
    onError: (error) => setPageError(error instanceof ApiError ? error.message : '删除邀请码失败'),
  });

  useEffect(() => {
    if (settingsQuery.data) {
      setSystemDraft(settingsQuery.data);
    }
  }, [settingsQuery.data]);

  const updateSystemDraft = (updater: (current: SystemSettings) => SystemSettings) => {
    setSystemDraft((current) => (current ? updater(current) : current));
  };

  const saveSystemDraft = () => {
    if (!systemDraft) {
      return;
    }

    setPageError(null);
    updateSettingsMutation.mutate(systemDraft);
  };

  return (
    <div className="settings-view">
      <div className="settings-tabs">
        <button type="button" className={cn('tab-button', settingsTab === 'users' && 'active')} onClick={() => setSettingsTab('users')}>用户</button>
        <button type="button" className={cn('tab-button', settingsTab === 'system' && 'active')} onClick={() => setSettingsTab('system')}>系统</button>
        <button type="button" className={cn('tab-button', settingsTab === 'invites' && 'active')} onClick={() => setSettingsTab('invites')}>邀请码</button>
      </div>

      {pageError ? <div className="error-banner">{pageError}</div> : null}

      {settingsTab === 'users' ? (
        <div className="settings-table-shell">
          <table className="settings-table">
            <thead>
              <tr>
                <th>用户名</th>
                <th>角色</th>
                <th>状态</th>
                <th>创建时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {(usersQuery.data ?? []).map((item: AdminUserSummary) => (
                <tr key={item.id}>
                  <td className="settings-table-strong">{item.username}</td>
                  <td><span className="stream-pill">{item.role}</span></td>
                  <td>{item.status}</td>
                  <td>{new Date(item.createdAt).toLocaleString()}</td>
                  <td>
                    <div className="settings-actions nowrap">
                      <button
                        type="button"
                        className="subtle-button"
                        disabled={updateUserMutation.isPending}
                        onClick={() => updateUserMutation.mutate({
                          userId: item.id,
                          payload: { role: item.role === 'admin' ? 'member' : 'admin' },
                        })}
                      >
                        {item.role === 'admin' ? '降为成员' : '设为管理员'}
                      </button>
                      <button
                        type="button"
                        className="subtle-button"
                        disabled={updateUserMutation.isPending}
                        onClick={() => updateUserMutation.mutate({
                          userId: item.id,
                          payload: { status: item.status === 'active' ? 'disabled' : 'active' },
                        })}
                      >
                        {item.status === 'active' ? '禁用' : '启用'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {settingsTab === 'system' && systemDraft ? (
        <div className="settings-grid">
          <article className="status-card">
            <div className="settings-row">
              <strong>注册邀请码</strong>
              <button
                type="button"
                className="subtle-button"
                disabled={updateSettingsMutation.isPending}
                onClick={() => updateSettingsMutation.mutate({
                  registrationRequiresInviteCode: !systemDraft.registrationRequiresInviteCode,
                })}
              >
                {systemDraft.registrationRequiresInviteCode ? '当前需要邀请码' : '当前开放注册'}
              </button>
            </div>
            <div className="file-meta">切换后，对后续注册请求立即生效。</div>
          </article>

          <article className="status-card">
            <strong>Assistant Tools</strong>
            <div className="settings-actions">
              <button
                type="button"
                className="subtle-button"
                disabled={updateSettingsMutation.isPending}
                onClick={() => updateSettingsMutation.mutate({
                  enableAssistantTools: !systemDraft.enableAssistantTools,
                })}
              >
                {systemDraft.enableAssistantTools ? '已启用' : '已关闭'}
              </button>
            </div>
          </article>

          <article className="status-card">
            <strong>运行配置</strong>
            <div className="settings-stack">
              <label className="field-group">
                <span>Web Origin</span>
                <input
                  value={systemDraft.webOrigin}
                  onChange={(event) => {
                    updateSystemDraft((current) => ({
                      ...current,
                      webOrigin: event.target.value,
                    }));
                  }}
                />
              </label>
              <div className="settings-grid two-columns">
                <label className="field-group">
                  <span>OpenAI Base URL</span>
                  <input
                    value={systemDraft.modelConfig.openaiBaseUrl}
                    onChange={(event) => {
                      updateSystemDraft((current) => ({
                        ...current,
                        modelConfig: {
                          ...current.modelConfig,
                          openaiBaseUrl: event.target.value,
                        },
                      }));
                    }}
                  />
                </label>
                <label className="field-group">
                  <span>OpenAI API Key</span>
                  <input
                    type="password"
                    value={systemDraft.modelConfig.openaiApiKey}
                    onChange={(event) => {
                      updateSystemDraft((current) => ({
                        ...current,
                        modelConfig: {
                          ...current.modelConfig,
                          openaiApiKey: event.target.value,
                        },
                      }));
                    }}
                  />
                </label>
                <label className="field-group">
                  <span>OpenAI Model</span>
                  <input
                    value={systemDraft.modelConfig.openaiModel}
                    onChange={(event) => {
                      updateSystemDraft((current) => ({
                        ...current,
                        modelConfig: {
                          ...current.modelConfig,
                          openaiModel: event.target.value,
                        },
                      }));
                    }}
                  />
                </label>
                <label className="field-group">
                  <span>Reasoning Effort</span>
                  <select
                    className="select-field"
                    value={systemDraft.modelConfig.openaiReasoningEffort}
                    onChange={(event) => {
                      updateSystemDraft((current) => ({
                        ...current,
                        modelConfig: {
                          ...current.modelConfig,
                          openaiReasoningEffort: event.target.value as SystemSettings['modelConfig']['openaiReasoningEffort'],
                        },
                      }));
                    }}
                  >
                    <option value="minimal">minimal</option>
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                    <option value="xhigh">xhigh</option>
                  </select>
                </label>
                <label className="field-group">
                  <span>LLM Max Output Tokens</span>
                  <input
                    type="number"
                    min={1}
                    value={String(systemDraft.modelConfig.llmMaxOutputTokens)}
                    onChange={(event) => {
                      updateSystemDraft((current) => ({
                        ...current,
                        modelConfig: {
                          ...current.modelConfig,
                          llmMaxOutputTokens: Math.max(1, Number(event.target.value || current.modelConfig.llmMaxOutputTokens)),
                        },
                      }));
                    }}
                  />
                </label>
                <label className="field-group">
                  <span>Tool Max Output Tokens</span>
                  <input
                    type="number"
                    min={1}
                    value={String(systemDraft.modelConfig.toolMaxOutputTokens)}
                    onChange={(event) => {
                      updateSystemDraft((current) => ({
                        ...current,
                        modelConfig: {
                          ...current.modelConfig,
                          toolMaxOutputTokens: Math.max(1, Number(event.target.value || current.modelConfig.toolMaxOutputTokens)),
                        },
                      }));
                    }}
                  />
                </label>
              </div>
            </div>
            <div className="settings-actions">
              <button
                type="button"
                className="primary-button"
                disabled={updateSettingsMutation.isPending}
                onClick={saveSystemDraft}
              >
                保存模型配置
              </button>
            </div>
          </article>
        </div>
      ) : null}

      {settingsTab === 'invites' ? (
        <div className="settings-stack">
          <article className="status-card">
            <strong>批量创建邀请码</strong>
            <div className="settings-actions">
              <input value={inviteBatchCount} onChange={(event) => setInviteBatchCount(event.target.value)} />
              <button
                type="button"
                className="primary-button"
                disabled={createInvitesMutation.isPending}
                onClick={() => createInvitesMutation.mutate(Math.max(1, Math.min(100, Number(inviteBatchCount || '1'))))}
              >
                创建
              </button>
            </div>
            <div className="file-meta">单次最多创建 100 个邀请码。</div>
          </article>
          <div className="settings-table-shell">
            <table className="settings-table">
              <thead>
                <tr>
                  <th>邀请码</th>
                  <th>状态</th>
                  <th>创建时间</th>
                  <th>使用时间</th>
                  <th>使用者</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {(invitesQuery.data ?? []).map((invite: InviteCodeSummary) => (
                  <tr key={invite.code}>
                    <td className="settings-table-strong">{invite.code}</td>
                    <td><span className="stream-pill">{invite.usedBy ? '已使用' : '未使用'}</span></td>
                    <td>{new Date(invite.createdAt).toLocaleString()}</td>
                    <td>{invite.usedAt ? new Date(invite.usedAt).toLocaleString() : '-'}</td>
                    <td>{invite.usedBy ?? '-'}</td>
                    <td>
                      <div className="settings-actions nowrap">
                        <button
                          type="button"
                          className="subtle-button"
                          onClick={async () => {
                            try {
                              await navigator.clipboard.writeText(invite.code);
                            } catch {
                              setPageError('当前环境不支持复制到剪贴板');
                            }
                          }}
                        >
                          复制
                        </button>
                        {!invite.usedBy ? (
                          <button
                            type="button"
                            className="subtle-button"
                            disabled={deleteInviteMutation.isPending}
                            onClick={() => deleteInviteMutation.mutate(invite.code)}
                          >
                            删除
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
};

const SessionWorkspace = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { sessionId } = useParams();
  const user = useAuthStore((state) => state.user);
  const logout = useAuthStore((state) => state.logout);
  const setActiveSessionId = useUiStore((state) => state.setActiveSessionId);
  const activeSessionId = sessionId ?? null;
  const isSettingsView = location.pathname === '/app/settings';
  const mobilePanel = useUiStore((state) => state.mobilePanel);
  const setMobilePanel = useUiStore((state) => state.setMobilePanel);
  const drafts = useUiStore((state) => state.drafts);
  const setDraft = useUiStore((state) => state.setDraft);
  const clearStreamContent = useUiStore((state) => state.clearStreamContent);
  const hydrateRuntime = useUiStore((state) => state.hydrateRuntime);
  const confirmRemovedFollowUpInput = useUiStore((state) => state.confirmRemovedFollowUpInput);
  const stream = useSessionStream(activeSessionId);
  const [inspectorTab, setInspectorTab] = useState<'files' | 'skills'>('files');
  const [pageError, setPageError] = useState<string | null>(null);
  const [visibleSessionCount, setVisibleSessionCount] = useState(5);
  const [isCreateSessionOpen, setIsCreateSessionOpen] = useState(false);
  const [newSessionTitle, setNewSessionTitle] = useState('');
  const [newSessionSkills, setNewSessionSkills] = useState<string[]>([]);
  const [composerAttachmentsBySession, setComposerAttachmentsBySession] = useState<Record<string, ComposerAttachment[]>>({});
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const [keyboardInset, setKeyboardInset] = useState(0);
  const themeMode = usePreferencesStore((state) => state.themeMode);
  const setThemeMode = usePreferencesStore((state) => state.setThemeMode);

  useEffect(() => {
    setActiveSessionId(activeSessionId);
  }, [activeSessionId, setActiveSessionId]);

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
  const visibleSessions = useMemo(
    () => (sessionsQuery.data ?? []).slice(0, visibleSessionCount),
    [sessionsQuery.data, visibleSessionCount],
  );
  const hiddenSessionCount = Math.max(0, (sessionsQuery.data?.length ?? 0) - visibleSessionCount);

  const resetCreateSessionDraft = () => {
    setNewSessionTitle('');
    setNewSessionSkills([]);
  };

  const openCreateSessionDialog = () => {
    resetCreateSessionDraft();
    setPageError(null);
    setIsCreateSessionOpen(true);
  };

  const createSessionMutation = useMutation({
    mutationFn: (payload: { title?: string; activeSkills?: string[] }) => api.createSession(payload),
    onSuccess: (session) => {
      resetCreateSessionDraft();
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
    if (!sessionsQuery.isSuccess || isSettingsView || location.pathname.startsWith('/login') || location.pathname.startsWith('/register')) {
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
  }, [activeSessionId, isSettingsView, location.pathname, navigate, sessionsQuery.data, sessionsQuery.isSuccess]);

  useEffect(() => {
    if (!sessionsQuery.data) {
      return;
    }
    setVisibleSessionCount((current) => {
      const nextMin = Math.min(5, sessionsQuery.data.length);
      return Math.max(current, nextMin);
    });
  }, [sessionsQuery.data]);

  const messagesQuery = useQuery({
    queryKey: ['messages', activeSessionId],
    queryFn: () => api.listMessages(activeSessionId!),
    enabled: Boolean(activeSessionId && activeSession),
  });

  const filesQuery = useQuery({
    queryKey: ['files', activeSessionId],
    queryFn: () => api.listFiles({ sessionId: activeSessionId! }),
    enabled: Boolean(activeSessionId && activeSession),
  });

  const runtimeQuery = useQuery({
    queryKey: ['runtime', activeSessionId],
    queryFn: () => api.getSessionRuntime(activeSessionId!),
    enabled: Boolean(activeSessionId && activeSession) && !isSettingsView,
    refetchOnMount: 'always',
  });

  const skillsQuery = useQuery({
    queryKey: ['skills'],
    queryFn: api.listSkills,
  });
  const installedSkills = skillsQuery.data ?? [];

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
    setNewSessionSkills((current) => (
      current.includes(skillName)
        ? current.filter((item) => item !== skillName)
        : [...current, skillName]
    ));
  };

  useEffect(() => {
    if (activeSessionId && runtimeQuery.data && runtimeQuery.isFetchedAfterMount) {
      hydrateRuntime(activeSessionId, runtimeQuery.data);
    }
  }, [activeSessionId, hydrateRuntime, runtimeQuery.data, runtimeQuery.isFetchedAfterMount]);

  const sendMessageMutation = useMutation({
    mutationFn: (payload: { sessionId: string; content: string; activeTurnId: string | null }) => {
      if (payload.activeTurnId) {
        return api.sendMessage(payload.sessionId, {
          content: payload.content,
          dispatch: 'auto',
          turnId: payload.activeTurnId,
        });
      }
      return api.sendMessage(payload.sessionId, {
        content: payload.content,
        dispatch: 'new_turn',
      });
    },
    onMutate: async (payload) => {
      if (payload.sessionId) {
        const shouldOptimisticallyAppend = !stream.activeTurnId;
        if (shouldOptimisticallyAppend) {
          clearStreamContent(payload.sessionId);
        }
        const previous = queryClient.getQueryData<StoredEvent[]>(['messages', payload.sessionId]) ?? [];
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
        setComposerAttachmentsBySession((current) => {
          const { [variables.sessionId]: _removed, ...rest } = current;
          return rest;
        });
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
    onError: (error) => setPageError(error instanceof ApiError ? error.message : '取消待处理输入失败'),
  });

  const uploadMutation = useMutation({
    mutationFn: ({ sessionId, file }: { sessionId: string; file: File }) => api.uploadFile(sessionId, file),
    onSuccess: async (_record, variables) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['files', variables.sessionId] }),
        queryClient.invalidateQueries({ queryKey: ['messages', variables.sessionId] }),
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
  const thinkingEvent = useMemo(
    () => {
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
          createdAt: activeThinking?.createdAt ?? stream.activeTurnPhaseStartedAt ?? new Date().toISOString(),
        };
      }

      return activeThinking ?? (
        activeSessionId
          ? buildRuntimeThinkingEvent({
            sessionId: activeSessionId,
            phase: stream.activeTurnPhase,
            phaseStartedAt: stream.activeTurnPhaseStartedAt,
            round: stream.activeTurnRound,
          })
          : undefined
      );
    },
    [
      activeSessionId,
      activeThinking,
      stream.activeTurnId,
      stream.activeTurnPhase,
      stream.activeTurnPhaseStartedAt,
      stream.activeTurnRound,
      stream.reconnectAttempt,
      stream.reconnectLimit,
      stream.status,
    ],
  );

  useEffect(() => {
    const target = messageListRef.current;
    if (!target) {
      return;
    }
    target.scrollTop = target.scrollHeight;
  }, [timeline, thinkingEvent, stream.pendingText, stream.followUpQueue, activeSessionId]);

  const hasActiveSession = Boolean(activeSessionId && activeSession);
  const draft = hasActiveSession ? drafts[activeSessionId!] ?? '' : '';
  const composerAttachments = hasActiveSession ? composerAttachmentsBySession[activeSessionId!] ?? [] : [];
  const groupedFiles = useMemo(
    () => groupBy(filesQuery.data ?? [], (file) => file.bucket),
    [filesQuery.data],
  );
  const activeSkills = activeSession?.activeSkills ?? [];
  const activeSkillEntries = useMemo(
    () => installedSkills.filter((skill) => activeSkills.includes(skill.name)),
    [activeSkills, installedSkills],
  );
  const emptyStateStarterPrompts = useMemo(
    () => Array.from(new Set(activeSkillEntries.flatMap((skill) => skill.starterPrompts ?? []))).slice(0, 6),
    [activeSkillEntries],
  );
  const emptyStateStarterCaption = activeSkillEntries.length > 0
    ? `当前会话已启用：${activeSkillEntries.map((skill) => skill.name).join(' · ')}`
    : null;
  const isWechat = isWechatBrowser();
  const isTurnRunning = Boolean(stream.activeTurnId) && (
    stream.activeTurnStatus === 'running' || stream.activeTurnStatus === 'interrupting'
  );
  const hasUploadingAttachments = composerAttachments.some((item) => item.status === 'uploading');

  const updateComposerAttachments = (sessionKey: string, updater: (current: ComposerAttachment[]) => ComposerAttachment[]) => {
    setComposerAttachmentsBySession((current) => {
      const nextAttachments = updater(current[sessionKey] ?? []);
      if (nextAttachments.length === 0) {
        const { [sessionKey]: _removed, ...rest } = current;
        return rest;
      }
      return {
        ...current,
        [sessionKey]: nextAttachments,
      };
    });
  };

  const uploadComposerFiles = async (files: File[]) => {
    if (!activeSessionId || files.length === 0) {
      return;
    }

    setPageError(null);
    for (const [index, rawFile] of files.entries()) {
      const file = normalizeAttachmentFile(rawFile, index);
      const localId = createComposerAttachmentId();
      updateComposerAttachments(activeSessionId, (current) => [
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
        updateComposerAttachments(activeSessionId, (current) => current.map((item) => (
          item.localId === localId
            ? {
              ...item,
              displayName: record.displayName,
              mimeType: record.mimeType,
              size: record.size,
              status: 'uploaded',
            }
            : item
        )));
      } catch {
        updateComposerAttachments(activeSessionId, (current) => current.filter((item) => item.localId !== localId));
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
    const pastedImages = pastedImagesFromItems.length > 0
      ? pastedImagesFromItems
      : Array.from(event.clipboardData.files).filter((file) => file.type.startsWith('image/'));

    if (pastedImages.length === 0) {
      return;
    }

    event.preventDefault();
    void uploadComposerFiles(pastedImages);
  };

  const handleSend = () => {
    if (!activeSessionId || !draft.trim() || hasUploadingAttachments || sendMessageMutation.isPending || interruptMutation.isPending) {
      return;
    }
    const value = draft.trim();
    setDraft(activeSessionId, '');
    setPageError(null);
    sendMessageMutation.mutate({
      sessionId: activeSessionId,
      content: value,
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

  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (isSettingsView && user.role !== 'admin') {
    return <Navigate to="/app" replace />;
  }

  return (
    <div className="shell">
      <aside className={cn('side-panel sessions-panel', mobilePanel === 'sessions' && 'mobile-open')}>
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
                <div className="session-active-skills">
                  {session.activeSkills.join(' · ')}
                </div>
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

      <main className="workspace">
        <header className="workspace-header">
          <div>
            <div className="eyebrow">SkillChat</div>
            <h1>{isSettingsView ? '设置中心' : (activeSession?.title ?? '选择或创建会话')}</h1>
            <p>
              当前用户：{user.username}
              {!isSettingsView && hasActiveSession ? (
                <>
                  {' '}· 连接状态：
                  <span className={cn('stream-pill', `is-${stream.status}`)}>{stream.status}</span>
                  {isTurnRunning ? (
                    <>
                      {' '}· 当前 turn：
                      <span className="stream-pill is-open">
                        {stream.activeTurnKind ?? 'regular'} / {stream.activeTurnPhase ?? 'running'}
                        {stream.activeTurnRound ? ` / round ${stream.activeTurnRound}` : ''}
                      </span>
                    </>
                  ) : null}
                </>
              ) : null}
              {!isSettingsView && !hasActiveSession ? (
                <>
                  {' '}· 暂未进入会话，请先创建会话并选择本会话允许使用的 skills。
                </>
              ) : null}
            </p>
            {!isSettingsView && hasActiveSession && activeSkills.length > 0 ? (
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
            <button
              type="button"
              className="subtle-button"
              onClick={() => updateMySettingsMutation.mutate({
                themeMode: themeMode === 'dark' ? 'light' : 'dark',
              })}
            >
              {themeMode === 'dark' ? '浅色' : '深色'}
            </button>
            <button type="button" className="subtle-button" onClick={() => logout()}>
              退出
            </button>
          </div>
        </header>

        {pageError ? <div className="error-banner floating">{pageError}</div> : null}

        {isSettingsView ? (
          <section className="settings-stage">
            <AdminSettingsView pageError={pageError} setPageError={setPageError} />
          </section>
        ) : (
          <>
            {hasActiveSession ? (
              <>
                <section className="message-stage">
                  <div className="message-list" ref={messageListRef}>
                    {stream.recovery ? (
                      <div className="notice-card">
                        已从重启中恢复：之前的 {stream.recovery.previousTurnKind} turn
                        （{stream.recovery.previousTurnId}）已中断，未提交输入已恢复到待处理队列。
                      </div>
                    ) : null}
                    {timeline.length === 0 && !stream.pendingText && !thinkingEvent && stream.followUpQueue.length === 0 ? (
                      <EmptyState
                        title="开始一个任务"
                        detail={emptyStateStarterPrompts.length > 0
                          ? '你可以先点一个预设开场白，内容会直接进入聊天框，随后继续修改或发送。'
                          : '可以直接聊天或上传文件；如果要启用特定 skill，先在右侧面板把它加入当前会话。'}
                        action={emptyStateStarterPrompts.length > 0 ? (
                          <div className="empty-state-actions">
                            {emptyStateStarterCaption ? <div className="empty-state-caption">{emptyStateStarterCaption}</div> : null}
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
                        ) : undefined}
                      />
                    ) : null}
                    {timeline.map((event) => (
                      <MessageItem
                        key={event.id}
                        event={event}
                        onDownload={(file) => downloadMutation.mutate(file)}
                        downloading={downloadMutation.isPending}
                        canExpandToolTrace={user.role === 'admin'}
                      />
                    ))}
                    {stream.pendingText ? (
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
                        downloading={downloadMutation.isPending}
                        canExpandToolTrace={user.role === 'admin'}
                      />
                    ) : null}
                    {thinkingEvent ? (
                      <MessageItem
                        key={thinkingEvent.id}
                        event={thinkingEvent}
                        onDownload={(file) => downloadMutation.mutate(file)}
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
                    <label className="sr-only" htmlFor="chat-composer-input">聊天输入框</label>
                    <textarea
                      id="chat-composer-input"
                      className="composer-textarea"
                      ref={composerTextareaRef}
                      value={draft}
                      onChange={(event) => activeSessionId && setDraft(activeSessionId, event.target.value)}
                      onPaste={handleComposerPaste}
                      placeholder={isTurnRunning
                        ? '继续补充信息，系统会按顺序处理'
                        : '给 SkillChat 发送消息'}
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
                          aria-label={sendMessageMutation.isPending ? '提交中...' : isTurnRunning ? '补充信息' : '发送'}
                          title={sendMessageMutation.isPending ? '提交中...' : isTurnRunning ? '补充信息' : '发送'}
                          disabled={!draft.trim() || hasUploadingAttachments || sendMessageMutation.isPending || interruptMutation.isPending}
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
                    action={(
                      <div className="empty-state-actions">
                        <button type="button" className="primary-button" onClick={openCreateSessionDialog}>
                          新建会话
                        </button>
                        <div className="empty-state-caption">
                          会话创建后，你仍然可以在右侧面板调整当前会话启用的 skill 范围。
                        </div>
                      </div>
                    )}
                  />
                </div>
              </section>
            )}
          </>
        )}
      </main>

      {!isSettingsView ? (
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
            <div className="status-card muted">
              <strong>{hasActiveSession ? '当前会话 Skill 作用域' : '已安装 Skills'}</strong>
              <div className="file-meta">
                {hasActiveSession
                  ? (activeSkills.length > 0
                    ? `当前会话只允许使用这些 skills：${activeSkills.join(' · ')}。未启用的 skill 不会进入上下文，也不可调用。`
                    : '当前会话未启用任何 skill。未启用的 skill 不会进入上下文，也不可调用。')
                  : '项目中可以安装很多 skill，但只有加入当前会话的 skill 才会被读取、参考或执行。'}
              </div>
            </div>
            {installedSkills.map((skill: SkillMetadata) => (
              <article key={skill.name} className="skill-card">
                <div className="skill-card-header">
                  <div className="skill-title">{skill.name}</div>
                  {hasActiveSession ? (
                    <button
                      type="button"
                      className={cn('subtle-button', activeSkills.includes(skill.name) && 'is-active-skill')}
                      disabled={updateSessionMutation.isPending}
                      onClick={() => {
                        const nextSkills = activeSkills.includes(skill.name)
                          ? activeSkills.filter((item) => item !== skill.name)
                          : [...activeSkills, skill.name];
                        updateSessionMutation.mutate({
                          sessionId: activeSessionId!,
                          activeSkills: nextSkills,
                        });
                      }}
                    >
                      {activeSkills.includes(skill.name) ? '本会话已启用' : '加入会话'}
                    </button>
                  ) : (
                    <span className="stream-pill">已安装</span>
                  )}
                </div>
                <p>{skill.description}</p>
              </article>
            ))}
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
    <Route path="/bootstrap-admin" element={<BootstrapAdminPage />} />
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
    <Route
      path="/app/settings"
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
