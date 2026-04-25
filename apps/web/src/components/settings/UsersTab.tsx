import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AdminUserSummary } from '@skillchat/shared';
import { ApiError, api } from '@/lib/api';
import { Button } from '@/components/ui/button';

export interface UsersTabProps {
  setPageError: (value: string | null) => void;
}

export const UsersTab = ({ setPageError }: UsersTabProps) => {
  const queryClient = useQueryClient();
  const usersQuery = useQuery({
    queryKey: ['admin-users'],
    queryFn: api.listAdminUsers,
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
    onError: (error) =>
      setPageError(error instanceof ApiError ? error.message : '更新用户失败'),
  });

  return (
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
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={updateUserMutation.isPending}
                    onClick={() =>
                      updateUserMutation.mutate({
                        userId: item.id,
                        payload: { role: item.role === 'admin' ? 'member' : 'admin' },
                      })
                    }
                  >
                    {item.role === 'admin' ? '降为成员' : '设为管理员'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={updateUserMutation.isPending}
                    onClick={() =>
                      updateUserMutation.mutate({
                        userId: item.id,
                        payload: { status: item.status === 'active' ? 'disabled' : 'active' },
                      })
                    }
                  >
                    {item.status === 'active' ? '禁用' : '启用'}
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default UsersTab;
