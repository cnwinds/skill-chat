import { PanelLeftOpen, PanelRightOpen } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from './ThemeToggle';

export interface ChatHeaderProps {
  title: string;
  subtitle?: ReactNode;
  titleActions?: ReactNode;
  themeMode: 'light' | 'dark';
  onToggleTheme: () => void;
  onTitleClick?: () => void;
  onOpenSidebar: () => void;
  onOpenInspector: () => void;
  showInspectorToggle?: boolean;
  rightExtras?: ReactNode;
}

export const ChatHeader = ({
  title,
  subtitle,
  titleActions,
  themeMode,
  onToggleTheme,
  onTitleClick,
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
      <div className="flex min-w-0 items-center gap-1.5">
        <h1 className="min-w-0 text-base font-semibold text-foreground">
          {onTitleClick ? (
            <button
              type="button"
              onClick={onTitleClick}
              className="block max-w-full truncate rounded-sm text-left hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label={`修改会话标题：${title}`}
              title="点击修改标题"
            >
              {title}
            </button>
          ) : (
            <span className="block truncate">{title}</span>
          )}
        </h1>
        {titleActions ? (
          <div className="flex shrink-0 items-center gap-0.5">{titleActions}</div>
        ) : null}
      </div>
      {subtitle ? (
        <p className="truncate text-2xs text-foreground-muted">{subtitle}</p>
      ) : null}
    </div>

    <div className="flex items-center gap-1">
      {rightExtras}

      <ThemeToggle themeMode={themeMode} onToggle={onToggleTheme} />

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
