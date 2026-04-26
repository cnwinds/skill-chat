import { useEffect, useState } from 'react';
import {
  Loader2,
  LogOut,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings,
  Trash2,
  UserCircle,
} from 'lucide-react';
import type { SessionSummary, UserSummary } from '@skillchat/shared';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export interface SidebarProps {
  sessions: SessionSummary[];
  visibleSessionCount: number;
  hiddenSessionCount: number;
  activeSessionId: string | null;
  runningSessionIds: Set<string>;
  isSettingsView: boolean;
  showSettingsEntry: boolean;
  user: UserSummary;
  actionPending?: boolean;
  logoutPending?: boolean;
  onSelectSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, title: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onSelectSettings: () => void;
  onCreateSession: () => void;
  onLoadMoreSessions: () => void;
  onLogout: () => void;
}

export const Sidebar = ({
  sessions,
  visibleSessionCount,
  hiddenSessionCount,
  activeSessionId,
  runningSessionIds,
  isSettingsView,
  showSettingsEntry,
  user,
  actionPending = false,
  logoutPending = false,
  onSelectSession,
  onRenameSession,
  onDeleteSession,
  onSelectSettings,
  onCreateSession,
  onLoadMoreSessions,
  onLogout,
}: SidebarProps) => {
  const visible = sessions.slice(0, visibleSessionCount);
  const [renameTarget, setRenameTarget] = useState<SessionSummary | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SessionSummary | null>(null);
  const [renameTitle, setRenameTitle] = useState('');

  useEffect(() => {
    setRenameTitle(renameTarget?.title ?? '');
  }, [renameTarget]);

  const submitRename = () => {
    if (!renameTarget || !renameTitle.trim()) {
      return;
    }
    onRenameSession(renameTarget.id, renameTitle.trim());
    setRenameTarget(null);
  };

  const confirmDelete = () => {
    if (!deleteTarget) {
      return;
    }
    onDeleteSession(deleteTarget.id);
    setDeleteTarget(null);
  };

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

      <ScrollArea className="min-h-0 flex-1 px-2">
        <div className="flex flex-col gap-1 pb-3">
          {visible.map((session) => {
            const isActive = session.id === activeSessionId && !isSettingsView;
            const isRunning = runningSessionIds.has(session.id);
            return (
              <div
                key={session.id}
                className={cn(
                  'group/session relative rounded-md transition-colors',
                  isActive && 'bg-surface-hover',
                  !isActive && 'hover:bg-surface-hover',
                )}
              >
                <button
                  type="button"
                  aria-label={`打开会话：${session.title}${isRunning ? '，回应中' : ''}`}
                  onClick={() => onSelectSession(session.id)}
                  data-active={isActive ? 'true' : undefined}
                  className={cn(
                    'session-item flex w-full flex-col gap-0.5 rounded-md px-3 py-2 pr-9 text-left text-sm transition-colors',
                    isActive && 'active',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    {isRunning ? (
                      <span
                        aria-label="回应中"
                        className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]"
                      />
                    ) : null}
                    <span className="truncate font-medium text-foreground">{session.title}</span>
                    {isRunning ? (
                      <span className="shrink-0 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-2xs text-emerald-500">
                        回应中
                      </span>
                    ) : null}
                  </span>
                  {session.activeSkills.length > 0 ? (
                    <span className="truncate text-2xs text-foreground-muted">
                      {session.activeSkills.join(' · ')}
                    </span>
                  ) : null}
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={`打开会话操作：${session.title}`}
                      className={cn(
                        'absolute right-1.5 top-1.5 inline-flex h-7 w-7 items-center justify-center rounded-md text-foreground-muted transition hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                        'opacity-100 lg:opacity-0 lg:group-hover/session:opacity-100 lg:focus-visible:opacity-100',
                      )}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setRenameTarget(session)}>
                      <Pencil className="h-3.5 w-3.5" />
                      修改标题
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={isRunning}
                      onSelect={() => setDeleteTarget(session)}
                      className="text-danger focus:text-danger"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      删除会话
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
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

          {sessions.length === 0 ? (
            <div className="px-3 py-6 text-xs text-foreground-muted">还没有会话，点 + 新建一个。</div>
          ) : null}
        </div>
      </ScrollArea>

      <div className="border-t border-border p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))]">
        <div className="flex items-center gap-2 rounded-xl bg-surface px-2.5 py-2">
          <UserCircle className="h-5 w-5 shrink-0 text-foreground-muted" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{user.username}</div>
            <div className="text-2xs text-foreground-muted">
              {user.role === 'admin' ? '管理员' : '成员'}
            </div>
          </div>
          {showSettingsEntry ? (
            <button
              type="button"
              onClick={onSelectSettings}
              aria-label="设置"
              title="设置"
              className={cn(
                'inline-flex h-8 w-8 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                isSettingsView && 'bg-surface-hover text-foreground',
              )}
            >
              <Settings className="h-4 w-4" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onLogout}
            disabled={logoutPending}
            aria-label="退出"
            title="退出"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
          >
            {logoutPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <Dialog open={Boolean(renameTarget)} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>修改标题</DialogTitle>
            <DialogDescription>给这个会话换一个更容易识别的名称。</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              submitRename();
            }}
          >
            <Input
              aria-label="会话标题"
              value={renameTitle}
              onChange={(event) => setRenameTitle(event.target.value)}
              maxLength={80}
              autoFocus
            />
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setRenameTarget(null)}>
                取消
              </Button>
              <Button type="submit" disabled={actionPending || !renameTitle.trim()}>
                保存
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>删除会话</DialogTitle>
            <DialogDescription>
              删除后会从会话列表移除，相关聊天记录和会话文件会进入服务端回收目录。
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-md border border-border bg-surface-hover px-3 py-2 text-sm">
            {deleteTarget?.title}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDeleteTarget(null)}>
              取消
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={confirmDelete}
              disabled={actionPending}
            >
              删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Sidebar;
