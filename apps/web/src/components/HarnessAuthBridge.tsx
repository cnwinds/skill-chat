import { useMemo, type ReactNode } from 'react';
import { HarnessChatProvider, type HarnessAuthState } from '@skillchat/harness-react';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';

type HarnessAuthBridgeProps = {
  children: ReactNode;
};

export const HarnessAuthBridge = ({ children }: HarnessAuthBridgeProps) => {
  const user = useAuthStore((state) => state.user);
  const ready = useAuthStore((state) => state.ready);
  const setAnonymous = useAuthStore((state) => state.setAnonymous);

  const auth = useMemo<HarnessAuthState>(
    () => ({
      user: user
        ? { id: user.id, username: user.username, role: user.role }
        : null,
      ready,
      onUnauthorized: setAnonymous,
    }),
    [user, ready, setAnonymous],
  );

  const filesApi = useMemo(
    () => ({
      fetchFileBlob: api.fetchFileBlob,
      fetchFilePreviewBlob: api.fetchFilePreviewBlob,
    }),
    [],
  );

  return (
    <HarnessChatProvider apiBase="/api" inheritCssVariables auth={auth} filesApi={filesApi}>
      {children}
    </HarnessChatProvider>
  );
};
