import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';

export const AuthBootstrap = ({ children }: { children: ReactNode }) => {
  const ready = useAuthStore((state) => state.ready);
  const setAuthenticated = useAuthStore((state) => state.setAuthenticated);
  const setAnonymous = useAuthStore((state) => state.setAnonymous);

  const sessionQuery = useQuery({
    queryKey: ['auth-session'],
    queryFn: api.getAuthSession,
    retry: false,
    staleTime: 5 * 60 * 1000,
    enabled: !ready,
  });

  useEffect(() => {
    if (ready || sessionQuery.isPending) {
      return;
    }

    if (sessionQuery.data?.user) {
      setAuthenticated(sessionQuery.data.user);
      return;
    }

    if (sessionQuery.isSuccess || sessionQuery.isError) {
      setAnonymous();
    }
  }, [
    ready,
    sessionQuery.data,
    sessionQuery.isError,
    sessionQuery.isPending,
    sessionQuery.isSuccess,
    setAnonymous,
    setAuthenticated,
  ]);

  return <>{children}</>;
};

export const ProtectedRoute = ({ children }: { children: ReactNode }) => {
  const ready = useAuthStore((state) => state.ready);
  const user = useAuthStore((state) => state.user);

  if (!ready) {
    return <div className="auth-page">正在恢复登录状态...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

export const PublicOnlyRoute = ({ children }: { children: ReactNode }) => {
  const ready = useAuthStore((state) => state.ready);
  const user = useAuthStore((state) => state.user);

  if (!ready) {
    return <div className="auth-page">正在恢复登录状态...</div>;
  }

  if (user) {
    return <Navigate to="/app" replace />;
  }

  return <>{children}</>;
};

export const AdminGuard = ({ children }: { children: ReactNode }) => {
  const user = useAuthStore((state) => state.user);
  if (!user || user.role !== 'admin') {
    return <Navigate to="/app" replace />;
  }
  return <>{children}</>;
};
