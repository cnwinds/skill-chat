import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { loginSchema } from '@skillchat/shared';
import { ApiError, api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { Button } from '@/components/ui/button';
import { AuthCard } from './AuthCard';

const firstIssueMessage = (issues: Array<{ message: string }>) =>
  issues[0]?.message ?? '输入不合法';

export const LoginPage = () => {
  const navigate = useNavigate();
  const setAuthenticated = useAuthStore((state) => state.setAuthenticated);
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
      setAuthenticated(payload.user);
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
          <Button variant="link" type="button" size="sm" onClick={() => navigate('/register')}>
            还没有账号？去注册
          </Button>
          {systemStatusQuery.data && !systemStatusQuery.data.initialized ? (
            <Button
              variant="link"
              type="button"
              size="sm"
              onClick={() => navigate('/bootstrap-admin')}
            >
              首次启动？创建管理员
            </Button>
          ) : null}
        </>
      }
    />
  );
};

export default LoginPage;
