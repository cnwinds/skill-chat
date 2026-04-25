import { Plus, Settings } from 'lucide-react';
import type { SessionSummary } from '@skillchat/shared';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';

export interface SidebarProps {
  sessions: SessionSummary[];
  visibleSessionCount: number;
  hiddenSessionCount: number;
  activeSessionId: string | null;
  isSettingsView: boolean;
  showSettingsEntry: boolean;
  onSelectSession: (sessionId: string) => void;
  onSelectSettings: () => void;
  onCreateSession: () => void;
  onLoadMoreSessions: () => void;
}

export const Sidebar = ({
  sessions,
  visibleSessionCount,
  hiddenSessionCount,
  activeSessionId,
  isSettingsView,
  showSettingsEntry,
  onSelectSession,
  onSelectSettings,
  onCreateSession,
  onLoadMoreSessions,
}: SidebarProps) => {
  const visible = sessions.slice(0, visibleSessionCount);

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-4">
        <h2 className="text-sm font-semibold tracking-wide text-foreground-muted">SkillChat</h2>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCreateSession}
          title="新建会话"
          className="gap-1 px-2 text-xs"
        >
          <Plus className="h-3.5 w-3.5" />
          新建
        </Button>
      </div>

      <ScrollArea className="flex-1 px-2">
        <div className="flex flex-col gap-0.5 pb-3">
          {showSettingsEntry ? (
            <button
              type="button"
              onClick={onSelectSettings}
              className={cn(
                'group flex flex-col gap-0.5 rounded-md px-3 py-2 text-left text-sm transition-colors',
                'hover:bg-surface-hover',
                isSettingsView && 'bg-surface-hover text-foreground',
              )}
            >
              <span className="flex items-center gap-2">
                <Settings className="h-3.5 w-3.5 text-foreground-muted group-hover:text-foreground" />
                <span className="font-medium">设置</span>
              </span>
              <span className="text-2xs text-foreground-muted">系统配置 / 用户 / 邀请码</span>
            </button>
          ) : null}

          {visible.map((session) => {
            const isActive = session.id === activeSessionId && !isSettingsView;
            return (
            <button
              key={session.id}
              type="button"
              onClick={() => onSelectSession(session.id)}
              data-active={isActive ? 'true' : undefined}
              className={cn(
                'session-item group flex flex-col gap-0.5 rounded-md px-3 py-2 text-left text-sm transition-colors',
                'hover:bg-surface-hover',
                isActive && 'active bg-surface-hover',
              )}
            >
              <span className="truncate font-medium text-foreground">{session.title}</span>
              {session.activeSkills.length > 0 ? (
                <span className="truncate text-2xs text-foreground-muted">
                  {session.activeSkills.join(' · ')}
                </span>
              ) : null}
            </button>
            );
          })}

          {hiddenSessionCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onLoadMoreSessions}
              className="mx-2 mt-1 self-start text-xs text-foreground-muted"
            >
              更多会话（还有 {hiddenSessionCount} 条）
            </Button>
          ) : null}

          {sessions.length === 0 && !showSettingsEntry ? (
            <div className="px-3 py-6 text-xs text-foreground-muted">还没有会话，点 + 新建一个。</div>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  );
};

export default Sidebar;
