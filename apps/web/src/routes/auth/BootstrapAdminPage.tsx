import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Navigate, useNavigate } from 'react-router-dom';
import { bootstrapAdminSchema } from '@skillchat/shared';
import { ApiError, api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { AuthCard } from './AuthCard';

const firstIssueMessage = (issues: Array<{ message: string }>) =>
  issues[0]?.message ?? '输入不合法';

export const BootstrapAdminPage = () => {
  const navigate = useNavigate();
  const setAuthenticated = useAuthStore((state) => state.setAuthenticated);
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
      setAuthenticated(payload.user);
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
        <Button variant="link" type="button" size="sm" onClick={() => navigate('/login')}>
          返回登录
        </Button>
      }
    />
  );
};

export default BootstrapAdminPage;
