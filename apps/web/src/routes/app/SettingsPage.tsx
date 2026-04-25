import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdminUserSummary,
  InviteCodeSummary,
  SystemSettings,
} from '@skillchat/shared';
import { ApiError, api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/cn';
import { ChatHeader } from '@/components/layout/ChatHeader';
import { useAppShellOutlet } from './AppShellContext';

interface AdminSettingsViewProps {
  setPageError: (value: string | null) => void;
}

const AdminSettingsView = ({ setPageError }: AdminSettingsViewProps) => {
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

  const tabClass = (active: boolean) =>
    cn(
      'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
      active
        ? 'bg-accent text-accent-foreground'
        : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground',
    );

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
      <div className="inline-flex items-center gap-1 self-start rounded-md bg-surface-hover p-1">
        <button
          type="button"
          className={tabClass(settingsTab === 'users')}
          onClick={() => setSettingsTab('users')}
        >
          用户
        </button>
        <button
          type="button"
          className={tabClass(settingsTab === 'system')}
          onClick={() => setSettingsTab('system')}
        >
          系统
        </button>
        <button
          type="button"
          className={tabClass(settingsTab === 'invites')}
          onClick={() => setSettingsTab('invites')}
        >
          邀请码
        </button>
      </div>

      {settingsTab === 'users' ? (
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-hover/60 text-xs uppercase tracking-wide text-foreground-muted">
                <th className="px-3 py-2 text-left font-medium">用户名</th>
                <th className="px-3 py-2 text-left font-medium">角色</th>
                <th className="px-3 py-2 text-left font-medium">状态</th>
                <th className="px-3 py-2 text-left font-medium">创建时间</th>
                <th className="px-3 py-2 text-left font-medium">操作</th>
              </tr>
            </thead>
            <tbody>
              {(usersQuery.data ?? []).map((item: AdminUserSummary) => (
                <tr key={item.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-medium">{item.username}</td>
                  <td className="px-3 py-2">
                    <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs">
                      {item.role}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-foreground-muted">{item.status}</td>
                  <td className="px-3 py-2 text-2xs text-foreground-muted">
                    {new Date(item.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        type="button"
                        className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground hover:bg-surface-hover disabled:opacity-50"
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
                        className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground hover:bg-surface-hover disabled:opacity-50"
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
        <div className="grid gap-3 md:grid-cols-2">
          <article className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
            <div className="flex items-center justify-between gap-2">
              <strong className="text-sm">注册邀请码</strong>
              <button
                type="button"
                className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground hover:bg-surface-hover disabled:opacity-50"
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
            <div className="text-2xs text-foreground-muted">切换后，对后续注册请求立即生效。</div>
          </article>

          <article className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
            <strong className="text-sm">Assistant Tools</strong>
            <button
              type="button"
              className="self-start rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground hover:bg-surface-hover disabled:opacity-50"
              disabled={updateSettingsMutation.isPending}
              onClick={() =>
                updateSettingsMutation.mutate({
                  enableAssistantTools: !systemDraft.enableAssistantTools,
                })
              }
            >
              {systemDraft.enableAssistantTools ? '已启用' : '已关闭'}
            </button>
          </article>

          <article className="md:col-span-2 flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
            <strong className="text-sm">运行配置</strong>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs text-foreground-muted">OpenAI Base URL</span>
                <input
                  className="h-9 rounded-md border border-border bg-surface px-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
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
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs text-foreground-muted">OpenAI API Key</span>
                <input
                  type="password"
                  className="h-9 rounded-md border border-border bg-surface px-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
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
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs text-foreground-muted">OpenAI Model</span>
                <input
                  className="h-9 rounded-md border border-border bg-surface px-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
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
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs text-foreground-muted">Reasoning Effort</span>
                <select
                  className="h-9 rounded-md border border-border bg-surface px-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
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
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs text-foreground-muted">LLM Max Output Tokens</span>
                <input
                  type="number"
                  min={1}
                  className="h-9 rounded-md border border-border bg-surface px-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
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
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs text-foreground-muted">Tool Max Output Tokens</span>
                <input
                  type="number"
                  min={1}
                  className="h-9 rounded-md border border-border bg-surface px-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
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
            <div className="flex justify-end">
              <button
                type="button"
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:brightness-110 disabled:opacity-50"
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
        <div className="flex flex-col gap-3">
          <article className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
            <strong className="text-sm">批量创建邀请码</strong>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={inviteBatchCount}
                onChange={(event) => setInviteBatchCount(event.target.value)}
                className="h-9 w-24 rounded-md border border-border bg-surface px-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              />
              <button
                type="button"
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-foreground hover:brightness-110 disabled:opacity-50"
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
            <div className="text-2xs text-foreground-muted">单次最多创建 100 个邀请码。</div>
          </article>
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-hover/60 text-xs uppercase tracking-wide text-foreground-muted">
                  <th className="px-3 py-2 text-left font-medium">邀请码</th>
                  <th className="px-3 py-2 text-left font-medium">状态</th>
                  <th className="px-3 py-2 text-left font-medium">创建时间</th>
                  <th className="px-3 py-2 text-left font-medium">使用时间</th>
                  <th className="px-3 py-2 text-left font-medium">使用者</th>
                  <th className="px-3 py-2 text-left font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {(invitesQuery.data ?? []).map((invite: InviteCodeSummary) => (
                  <tr key={invite.code} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 font-medium">{invite.code}</td>
                    <td className="px-3 py-2">
                      <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs">
                        {invite.usedBy ? '已使用' : '未使用'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-2xs text-foreground-muted">
                      {new Date(invite.createdAt).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-2xs text-foreground-muted">
                      {invite.usedAt ? new Date(invite.usedAt).toLocaleString() : '-'}
                    </td>
                    <td className="px-3 py-2">{invite.usedBy ?? '-'}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground hover:bg-surface-hover"
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
                            className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground hover:bg-surface-hover disabled:opacity-50"
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
    setPageError,
    themeMode,
    onToggleTheme,
    onLogout,
    logoutPending,
    openSidebarSheet,
  } = useAppShellOutlet();

  return (
    <main className="flex h-full min-h-0 flex-1 flex-col">
      <ChatHeader
        title="设置中心"
        subtitle={`当前用户：${user.username}`}
        themeMode={themeMode}
        onToggleTheme={onToggleTheme}
        onLogout={onLogout}
        logoutPending={logoutPending}
        onOpenSidebar={openSidebarSheet}
        onOpenInspector={() => undefined}
        showInspectorToggle={false}
      />

      <div className="flex-1 overflow-y-auto">
        <AdminSettingsView setPageError={setPageError} />
      </div>
    </main>
  );
};

export default SettingsPage;
