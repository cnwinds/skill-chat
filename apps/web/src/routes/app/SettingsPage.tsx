import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdminUserSummary,
  InviteCodeSummary,
  SystemSettings,
} from '@skillchat/shared';
import { ApiError, api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/utils';
import { useAppShellOutlet } from './AppShellContext';

interface AdminSettingsViewProps {
  pageError: string | null;
  setPageError: (value: string | null) => void;
}

const AdminSettingsView = ({ pageError, setPageError }: AdminSettingsViewProps) => {
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
    mutationFn: ({
      userId,
      payload,
    }: {
      userId: string;
      payload: { role?: 'admin' | 'member'; status?: 'active' | 'disabled' };
    }) => api.updateAdminUser(userId, payload),
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
        <button
          type="button"
          className={cn('tab-button', settingsTab === 'users' && 'active')}
          onClick={() => setSettingsTab('users')}
        >
          用户
        </button>
        <button
          type="button"
          className={cn('tab-button', settingsTab === 'system' && 'active')}
          onClick={() => setSettingsTab('system')}
        >
          系统
        </button>
        <button
          type="button"
          className={cn('tab-button', settingsTab === 'invites' && 'active')}
          onClick={() => setSettingsTab('invites')}
        >
          邀请码
        </button>
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
                  <td>
                    <span className="stream-pill">{item.role}</span>
                  </td>
                  <td>{item.status}</td>
                  <td>{new Date(item.createdAt).toLocaleString()}</td>
                  <td>
                    <div className="settings-actions nowrap">
                      <button
                        type="button"
                        className="subtle-button"
                        disabled={updateUserMutation.isPending}
                        onClick={() =>
                          updateUserMutation.mutate({
                            userId: item.id,
                            payload: { role: item.role === 'admin' ? 'member' : 'admin' },
                          })
                        }
                      >
                        {item.role === 'admin' ? '降为成员' : '设为管理员'}
                      </button>
                      <button
                        type="button"
                        className="subtle-button"
                        disabled={updateUserMutation.isPending}
                        onClick={() =>
                          updateUserMutation.mutate({
                            userId: item.id,
                            payload: { status: item.status === 'active' ? 'disabled' : 'active' },
                          })
                        }
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
                onClick={() =>
                  updateSettingsMutation.mutate({
                    registrationRequiresInviteCode: !systemDraft.registrationRequiresInviteCode,
                  })
                }
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
                onClick={() =>
                  updateSettingsMutation.mutate({
                    enableAssistantTools: !systemDraft.enableAssistantTools,
                  })
                }
              >
                {systemDraft.enableAssistantTools ? '已启用' : '已关闭'}
              </button>
            </div>
          </article>

          <article className="status-card">
            <strong>运行配置</strong>
            <div className="settings-stack">
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
                          openaiReasoningEffort: event.target
                            .value as SystemSettings['modelConfig']['openaiReasoningEffort'],
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
                          llmMaxOutputTokens: Math.max(
                            1,
                            Number(event.target.value || current.modelConfig.llmMaxOutputTokens),
                          ),
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
                          toolMaxOutputTokens: Math.max(
                            1,
                            Number(event.target.value || current.modelConfig.toolMaxOutputTokens),
                          ),
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
              <input
                value={inviteBatchCount}
                onChange={(event) => setInviteBatchCount(event.target.value)}
              />
              <button
                type="button"
                className="primary-button"
                disabled={createInvitesMutation.isPending}
                onClick={() =>
                  createInvitesMutation.mutate(
                    Math.max(1, Math.min(100, Number(inviteBatchCount || '1'))),
                  )
                }
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
                    <td>
                      <span className="stream-pill">{invite.usedBy ? '已使用' : '未使用'}</span>
                    </td>
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

export const SettingsPage = () => {
  const user = useAuthStore((state) => state.user)!;
  const {
    pageError,
    setPageError,
    themeMode,
    onToggleTheme,
    onLogout,
    logoutPending,
    mobilePanel,
    setMobilePanel,
  } = useAppShellOutlet();

  return (
    <main className="workspace">
      <header className="workspace-header">
        <div>
          <div className="eyebrow">SkillChat</div>
          <h1>设置中心</h1>
          <p>当前用户：{user.username}</p>
        </div>

        <div className="header-actions">
          <button
            type="button"
            className="subtle-button mobile-only"
            onClick={() => setMobilePanel(mobilePanel === 'sessions' ? null : 'sessions')}
          >
            会话
          </button>
          <button type="button" className="subtle-button" onClick={onToggleTheme}>
            {themeMode === 'dark' ? '浅色' : '深色'}
          </button>
          <button type="button" className="subtle-button" onClick={onLogout} disabled={logoutPending}>
            退出
          </button>
        </div>
      </header>

      <section className="settings-stage">
        <AdminSettingsView pageError={pageError} setPageError={setPageError} />
      </section>
    </main>
  );
};

export default SettingsPage;
