import { Files, MessagesSquare, Sparkles } from 'lucide-react';
import { cn } from '@/lib/cn';

export type MobileTab = 'chat' | 'files' | 'skills';

export interface MobileTabBarProps {
  active: MobileTab;
  onChange: (tab: MobileTab) => void;
}

const items: Array<{ id: MobileTab; label: string; icon: typeof Files }> = [
  { id: 'chat', label: '聊天', icon: MessagesSquare },
  { id: 'files', label: '文件', icon: Files },
  { id: 'skills', label: 'Skill', icon: Sparkles },
];

export const MobileTabBar = ({ active, onChange }: MobileTabBarProps) => (
  <nav className="grid grid-cols-3 border-t border-border bg-background lg:hidden">
    {items.map((item) => {
      const Icon = item.icon;
      const isActive = active === item.id;
      return (
        <button
          key={item.id}
          type="button"
          onClick={() => onChange(item.id)}
          className={cn(
            'flex flex-col items-center justify-center gap-0.5 py-2 text-2xs transition-colors',
            isActive ? 'text-accent' : 'text-foreground-muted hover:text-foreground',
          )}
        >
          <Icon className="h-4 w-4" />
          <span>{item.label}</span>
        </button>
      );
    })}
  </nav>
);

export default MobileTabBar;
