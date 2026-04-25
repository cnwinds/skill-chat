import { LogOut, PanelLeftOpen, PanelRightOpen } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import { ThemeToggle } from './ThemeToggle';

export interface ChatHeaderProps {
  title: string;
  subtitle?: ReactNode;
  statusLabel?: string;
  statusTone?: 'idle' | 'running' | 'reconnecting' | 'error';
  themeMode: 'light' | 'dark';
  onToggleTheme: () => void;
  onLogout: () => void;
  logoutPending?: boolean;
  onOpenSidebar: () => void;
  onOpenInspector: () => void;
  showInspectorToggle?: boolean;
  rightExtras?: ReactNode;
}

const toneClass: Record<NonNullable<ChatHeaderProps['statusTone']>, string> = {
  idle: 'bg-foreground-muted/40',
  running: 'bg-emerald-500',
  reconnecting: 'bg-amber-500 animate-pulse-dot',
  error: 'bg-danger',
};

export const ChatHeader = ({
  title,
  subtitle,
  statusLabel,
  statusTone = 'idle',
  themeMode,
  onToggleTheme,
  onLogout,
  logoutPending = false,
  onOpenSidebar,
  onOpenInspector,
  showInspectorToggle = true,
  rightExtras,
}: ChatHeaderProps) => (
  <header className="flex min-h-12 items-start gap-2 border-b border-border bg-background px-3 py-2">
    <Button
      variant="ghost"
      size="icon-sm"
      onClick={onOpenSidebar}
      aria-label="打开会话列表"
      className="lg:hidden mt-0.5"
    >
      <PanelLeftOpen className="h-4 w-4" />
    </Button>

    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
      <h1 className="truncate text-sm font-medium text-foreground">{title}</h1>
      {subtitle ? (
        <p className="truncate text-2xs text-foreground-muted">{subtitle}</p>
      ) : null}
    </div>

    <div className="flex items-center gap-1">
      {statusLabel ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-2xs text-foreground-muted"
                aria-label={statusLabel}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', toneClass[statusTone])} />
                <span className="hidden sm:inline">{statusLabel}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent>{statusLabel}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : null}

      {rightExtras}

      <ThemeToggle themeMode={themeMode} onToggle={onToggleTheme} />

      <Button
        variant="ghost"
        size="icon-sm"
        onClick={onLogout}
        disabled={logoutPending}
        aria-label="退出"
        title="退出"
      >
        <LogOut className="h-4 w-4" />
      </Button>

      {showInspectorToggle ? (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onOpenInspector}
          aria-label="打开文件与 Skill 面板"
          className="lg:hidden"
        >
          <PanelRightOpen className="h-4 w-4" />
        </Button>
      ) : null}
    </div>
  </header>
);

export default ChatHeader;
