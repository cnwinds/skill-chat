import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { SessionSummary, SkillMetadata } from '@skillchat/shared';
import { ApiError, api, type InstalledSkillRecord, type SkillInstallRequest } from '@/lib/api';
import { toast } from '@/components/ui/toaster';

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof ApiError || error instanceof Error ? error.message : fallback;

const installedRecordToMetadata = (record: InstalledSkillRecord): SkillMetadata => ({
  name: record.id,
  description: record.manifest.description,
  starterPrompts: [...record.manifest.starterPrompts],
});

const getInstalledSkillTitle = (record: InstalledSkillRecord) =>
  record.manifest.displayName ?? record.id;

export const useSkillMutations = () => {
  const queryClient = useQueryClient();

  const installMutation = useMutation({
    mutationFn: (payload: SkillInstallRequest) => api.installSkill(payload),
    onSuccess: (record) => {
      queryClient.setQueryData<SkillMetadata[]>(['skills'], (current) => {
        const nextSkill = installedRecordToMetadata(record);
        const rest = (current ?? []).filter((skill) => skill.name !== record.id);
        return [nextSkill, ...rest];
      });
      queryClient.setQueryData<InstalledSkillRecord[]>(['user-installed-skills'], (current) => {
        const rest = (current ?? []).filter(
          (item) => !(item.id === record.id && item.version === record.version),
        );
        return [record, ...rest];
      });
      void queryClient.invalidateQueries({ queryKey: ['skills'] });
      void queryClient.invalidateQueries({ queryKey: ['user-installed-skills'] });
      toast({
        title: 'Skill 已安装',
        description: getInstalledSkillTitle(record),
      });
    },
    onError: (error) =>
      toast({
        title: '安装 Skill 失败',
        description: getErrorMessage(error, '安装 Skill 失败'),
        variant: 'destructive',
      }),
  });

  const uninstallMutation = useMutation({
    mutationFn: (payload: SkillInstallRequest) => api.uninstallSkill(payload),
    onSuccess: (record) => {
      queryClient.setQueryData<SkillMetadata[]>(['skills'], (current) =>
        current?.filter((skill) => skill.name !== record.id) ?? [],
      );
      queryClient.setQueryData<InstalledSkillRecord[]>(['user-installed-skills'], (current) =>
        current?.filter(
          (item) => !(item.id === record.id && item.version === record.version),
        ) ?? [],
      );
      queryClient.setQueryData<SessionSummary[]>(['sessions'], (current) =>
        current?.map((session) => ({
          ...session,
          activeSkills: session.activeSkills.filter((skillName) => skillName !== record.id),
        })) ?? [],
      );
      void queryClient.invalidateQueries({ queryKey: ['skills'] });
      void queryClient.invalidateQueries({ queryKey: ['user-installed-skills'] });
      void queryClient.invalidateQueries({ queryKey: ['sessions'] });
      toast({
        title: 'Skill 已卸载',
        description: getInstalledSkillTitle(record),
      });
    },
    onError: (error) =>
      toast({
        title: '卸载 Skill 失败',
        description: getErrorMessage(error, '卸载 Skill 失败'),
        variant: 'destructive',
      }),
  });

  return { installMutation, uninstallMutation };
};
