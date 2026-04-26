import { useState } from 'react';
import { useAuthStore } from '@/stores/auth-store';
import { cn } from '@/lib/cn';
import { ChatHeader } from '@/components/layout/ChatHeader';
import { UsersTab } from '@/components/settings/UsersTab';
import { SystemTab } from '@/components/settings/SystemTab';
import { InvitesTab } from '@/components/settings/InvitesTab';
import { useAppShellOutlet } from './AppShellContext';

type SettingsTab = 'users' | 'system' | 'invites';

export const SettingsPage = () => {
  const user = useAuthStore((state) => state.user)!;
  const {
    setPageError,
    themeMode,
    onToggleTheme,
    openSidebarSheet,
  } = useAppShellOutlet();

  const [tab, setTab] = useState<SettingsTab>('users');

  const tabClass = (active: boolean) =>
    cn(
      'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
      active
        ? 'bg-accent text-accent-foreground'
        : 'text-foreground-muted hover:bg-surface-hover hover:text-foreground',
    );

  return (
    <main className="flex h-full min-h-0 flex-1 flex-col">
      <ChatHeader
        title="设置中心"
        subtitle={`当前用户：${user.username}`}
        themeMode={themeMode}
        onToggleTheme={onToggleTheme}
        onOpenSidebar={openSidebarSheet}
        onOpenInspector={() => undefined}
        showInspectorToggle={false}
      />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
          <div className="inline-flex items-center gap-1 self-start rounded-md bg-surface-hover p-1">
            <button type="button" className={tabClass(tab === 'users')} onClick={() => setTab('users')}>
              用户
            </button>
            <button type="button" className={tabClass(tab === 'system')} onClick={() => setTab('system')}>
              系统
            </button>
            <button type="button" className={tabClass(tab === 'invites')} onClick={() => setTab('invites')}>
              邀请码
            </button>
          </div>

          {tab === 'users' ? <UsersTab setPageError={setPageError} /> : null}
          {tab === 'system' ? <SystemTab setPageError={setPageError} /> : null}
          {tab === 'invites' ? <InvitesTab setPageError={setPageError} /> : null}
        </div>
      </div>
    </main>
  );
};

export default SettingsPage;
