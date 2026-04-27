import { Check, Package, Plus } from 'lucide-react';
import type { SkillMetadata } from '@skillchat/shared';
import { cn } from '@/lib/cn';

export interface SkillCardProps {
  skill: SkillMetadata;
  selected?: boolean;
  disabled?: boolean;
  onToggle?: (() => void) | undefined;
}

export const SkillCard = ({
  skill,
  selected = false,
  disabled = false,
  onToggle,
}: SkillCardProps) => {
  const isToggleable = typeof onToggle === 'function';
  const buttonLabel = selected ? `本会话已启用：${skill.name}` : `加入会话：${skill.name}`;
  const installedLabel = `${skill.name} 已安装`;

  return (
    <article
      className={cn(
        'group/sc relative flex w-full min-w-0 max-w-full flex-col gap-1.5 overflow-hidden rounded-md border bg-surface px-2.5 py-2 transition-colors',
        selected
          ? 'border-accent/60 bg-accent/5'
          : 'border-border hover:border-border-strong hover:bg-surface-hover',
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-foreground" title={skill.name}>
            {skill.name}
          </div>
        </div>
        {isToggleable ? (
          <button
            type="button"
            disabled={disabled}
            onClick={onToggle}
            aria-label={buttonLabel}
            title={buttonLabel}
            className={cn(
              'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-foreground-muted transition-colors',
              selected
                ? 'border-accent bg-accent text-accent-foreground hover:brightness-110'
                : 'border-border hover:bg-surface-hover hover:text-foreground',
              disabled && 'cursor-not-allowed opacity-60',
            )}
          >
            {selected ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          </button>
        ) : (
          <span
            title={installedLabel}
            aria-label={installedLabel}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border text-foreground-muted"
          >
            <Package className="h-3.5 w-3.5" />
          </span>
        )}
      </div>

      <p className="line-clamp-2 overflow-hidden break-words text-xs leading-5 text-foreground-muted">
        {skill.description}
      </p>
    </article>
  );
};

export default SkillCard;
