import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { registerRequestSchema } from '@skillchat/shared';
import { ApiError, api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { AuthCard } from './AuthCard';

const firstIssueMessage = (issues: Array<{ message: string }>) =>
  issues[0]?.message ?? '输入不合法';

export const RegisterPage = () => {
  const navigate = useNavigate();
  const setAuthenticated = useAuthStore((state) => state.setAuthenticated);
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
      setAuthenticated(payload.user);
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

export default RegisterPage;
