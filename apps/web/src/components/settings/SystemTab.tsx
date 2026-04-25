import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SystemSettings } from '@skillchat/shared';
import { ApiError, api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface SystemTabProps {
  setPageError: (value: string | null) => void;
}

export const SystemTab = ({ setPageError }: SystemTabProps) => {
  const queryClient = useQueryClient();
  const [systemDraft, setSystemDraft] = useState<SystemSettings | null>(null);

  const settingsQuery = useQuery({
    queryKey: ['admin-system-settings'],
    queryFn: api.getAdminSystemSettings,
  });

  const updateSettingsMutation = useMutation({
    mutationFn: (payload: Partial<SystemSettings>) => api.updateAdminSystemSettings(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-system-settings'] });
    },
    onError: (error) =>
      setPageError(error instanceof ApiError ? error.message : '更新系统配置失败'),
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

  if (!systemDraft) {
    return null;
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <article className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
        <div className="flex items-center justify-between gap-2">
          <strong className="text-sm">注册邀请码</strong>
          <Button
            variant="outline"
            size="sm"
            disabled={updateSettingsMutation.isPending}
            onClick={() =>
              updateSettingsMutation.mutate({
                registrationRequiresInviteCode: !systemDraft.registrationRequiresInviteCode,
              })
            }
          >
            {systemDraft.registrationRequiresInviteCode ? '当前需要邀请码' : '当前开放注册'}
          </Button>
        </div>
        <div className="text-2xs text-foreground-muted">切换后，对后续注册请求立即生效。</div>
      </article>

      <article className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
        <strong className="text-sm">Assistant Tools</strong>
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          disabled={updateSettingsMutation.isPending}
          onClick={() =>
            updateSettingsMutation.mutate({
              enableAssistantTools: !systemDraft.enableAssistantTools,
            })
          }
        >
          {systemDraft.enableAssistantTools ? '已启用' : '已关闭'}
        </Button>
      </article>

      <article className="md:col-span-2 flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
        <strong className="text-sm">运行配置</strong>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-foreground-muted">OpenAI Base URL</span>
            <Input
              value={systemDraft.modelConfig.openaiBaseUrl}
              onChange={(event) =>
                updateSystemDraft((current) => ({
                  ...current,
                  modelConfig: { ...current.modelConfig, openaiBaseUrl: event.target.value },
                }))
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-foreground-muted">OpenAI API Key</span>
            <Input
              type="password"
              value={systemDraft.modelConfig.openaiApiKey}
              onChange={(event) =>
                updateSystemDraft((current) => ({
                  ...current,
                  modelConfig: { ...current.modelConfig, openaiApiKey: event.target.value },
                }))
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-foreground-muted">OpenAI Model</span>
            <Input
              value={systemDraft.modelConfig.openaiModel}
              onChange={(event) =>
                updateSystemDraft((current) => ({
                  ...current,
                  modelConfig: { ...current.modelConfig, openaiModel: event.target.value },
                }))
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-foreground-muted">Reasoning Effort</span>
            <select
              className="h-9 rounded-md border border-border bg-surface px-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
              value={systemDraft.modelConfig.openaiReasoningEffort}
              onChange={(event) =>
                updateSystemDraft((current) => ({
                  ...current,
                  modelConfig: {
                    ...current.modelConfig,
                    openaiReasoningEffort: event.target
                      .value as SystemSettings['modelConfig']['openaiReasoningEffort'],
                  },
                }))
              }
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
            <Input
              type="number"
              min={1}
              value={String(systemDraft.modelConfig.llmMaxOutputTokens)}
              onChange={(event) =>
                updateSystemDraft((current) => ({
                  ...current,
                  modelConfig: {
                    ...current.modelConfig,
                    llmMaxOutputTokens: Math.max(
                      1,
                      Number(event.target.value || current.modelConfig.llmMaxOutputTokens),
                    ),
                  },
                }))
              }
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-foreground-muted">Tool Max Output Tokens</span>
            <Input
              type="number"
              min={1}
              value={String(systemDraft.modelConfig.toolMaxOutputTokens)}
              onChange={(event) =>
                updateSystemDraft((current) => ({
                  ...current,
                  modelConfig: {
                    ...current.modelConfig,
                    toolMaxOutputTokens: Math.max(
                      1,
                      Number(event.target.value || current.modelConfig.toolMaxOutputTokens),
                    ),
                  },
                }))
              }
            />
          </label>
        </div>
        <div className="flex justify-end">
          <Button onClick={saveSystemDraft} disabled={updateSettingsMutation.isPending}>
            保存模型配置
          </Button>
        </div>
      </article>
    </div>
  );
};

export default SystemTab;
