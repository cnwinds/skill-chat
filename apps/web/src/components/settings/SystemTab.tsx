import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SystemSettings } from '@skillchat/shared';
import { ApiError, api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RuntimeConfigSections } from '@/components/settings/RuntimeConfigSections';

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

  const saveRuntimeConfig = () => {
    if (!systemDraft) {
      return;
    }
    setPageError(null);
    updateSettingsMutation.mutate({
      modelConfig: systemDraft.modelConfig,
      webSearchConfig: systemDraft.webSearchConfig,
      imageConfig: systemDraft.imageConfig,
    });
  };

  const saveMarketConfig = () => {
    if (!systemDraft) {
      return;
    }
    setPageError(null);
    updateSettingsMutation.mutate({
      marketConfig: systemDraft.marketConfig,
    });
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
        <div className="flex items-center justify-between gap-2">
          <strong className="text-sm">Skill 市场</strong>
          <Button onClick={saveMarketConfig} disabled={updateSettingsMutation.isPending}>
            保存市场配置
          </Button>
        </div>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs text-foreground-muted">市场 Base URL</span>
          <Input
            value={systemDraft.marketConfig.marketBaseUrl}
            onChange={(event) =>
              updateSystemDraft((current) => ({
                ...current,
                marketConfig: {
                  ...current.marketConfig,
                  marketBaseUrl: event.target.value,
                },
              }))
            }
            placeholder="http://localhost:3100"
          />
        </label>
        <div className="text-2xs text-foreground-muted">
          用于浏览、安装 Skill 的外部市场服务地址。保存后立即生效，无需重启服务。
        </div>
      </article>

      <article className="md:col-span-2 flex flex-col gap-3 rounded-lg border border-border bg-surface p-3">
        <div className="flex items-center justify-between gap-2">
          <strong className="text-sm">运行配置</strong>
          <Button onClick={saveRuntimeConfig} disabled={updateSettingsMutation.isPending}>
            保存运行配置
          </Button>
        </div>
        <RuntimeConfigSections draft={systemDraft} onChange={updateSystemDraft} />
      </article>
    </div>
  );
};

export default SystemTab;
