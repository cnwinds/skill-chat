import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InviteCodeSummary } from '@skillchat/shared';
import { ApiError, api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface InvitesTabProps {
  setPageError: (value: string | null) => void;
}

export const InvitesTab = ({ setPageError }: InvitesTabProps) => {
  const queryClient = useQueryClient();
  const [inviteBatchCount, setInviteBatchCount] = useState('5');
  const invitesQuery = useQuery({
    queryKey: ['admin-invites'],
    queryFn: api.listAdminInviteCodes,
  });

  const createInvitesMutation = useMutation({
    mutationFn: (count: number) => api.createAdminInviteCodes(count),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-invites'] });
    },
    onError: (error) =>
      setPageError(error instanceof ApiError ? error.message : '创建邀请码失败'),
  });

  const deleteInviteMutation = useMutation({
    mutationFn: (code: string) => api.deleteAdminInviteCode(code),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-invites'] });
    },
    onError: (error) =>
      setPageError(error instanceof ApiError ? error.message : '删除邀请码失败'),
  });

  return (
    <div className="flex flex-col gap-3">
      <article className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
        <strong className="text-sm">批量创建邀请码</strong>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={inviteBatchCount}
            onChange={(event) => setInviteBatchCount(event.target.value)}
            className="w-24"
          />
          <Button
            disabled={createInvitesMutation.isPending}
            onClick={() =>
              createInvitesMutation.mutate(
                Math.max(1, Math.min(100, Number(inviteBatchCount || '1'))),
              )
            }
          >
            创建
          </Button>
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
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(invite.code);
                        } catch {
                          setPageError('当前环境不支持复制到剪贴板');
                        }
                      }}
                    >
                      复制
                    </Button>
                    {!invite.usedBy ? (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={deleteInviteMutation.isPending}
                        onClick={() => deleteInviteMutation.mutate(invite.code)}
                      >
                        删除
                      </Button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default InvitesTab;
