import { Download, Loader2 } from 'lucide-react';
import type { MarketSkillSummary } from '@/lib/api';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';

const skillKindLabels: Record<MarketSkillSummary['kind'], string> = {
  instruction: '指令',
  runtime: '运行时',
  hybrid: '混合',
};

const Tag = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <span
    className={cn(
      'inline-flex h-5 min-w-0 max-w-full items-center rounded-sm border border-border bg-background px-1.5 text-2xs text-foreground-muted',
      className,
    )}
  >
    <span className="min-w-0 truncate">{children}</span>
  </span>
);

export interface MarketSkillCardProps {
  skill: MarketSkillSummary;
  installed: boolean;
  installPending: boolean;
  onInstall: () => void;
  onClick: () => void;
}

export const MarketSkillCard = ({
  skill,
  installed,
  installPending,
  onInstall,
  onClick,
}: MarketSkillCardProps) => {
  const title = skill.displayName ?? skill.id;

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
      aria-label={`查看 ${title} 详情`}
      className={cn(
        'flex w-full cursor-pointer flex-col gap-2 rounded-lg border bg-surface px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        installed
          ? 'border-border-strong hover:border-accent/50'
          : 'border-border hover:border-border-strong hover:bg-surface-hover',
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground" title={title}>
            {title}
          </div>
          <div className="mt-0.5 truncate text-2xs text-foreground-muted">
            {skill.id} · v{skill.latestVersion}
          </div>
        </div>
        {installed ? (
          <span className="shrink-0 self-start rounded-sm border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-2xs text-accent">
            已安装
          </span>
        ) : null}
      </div>

      <p className="line-clamp-2 min-h-[2.5rem] break-words text-xs leading-5 text-foreground-muted">
        {skill.description}
      </p>

      <div className="flex min-w-0 items-end justify-between gap-2">
        <div className="flex min-w-0 flex-wrap gap-1 overflow-hidden">
          <Tag>{skillKindLabels[skill.kind]}</Tag>
          {skill.categories.slice(0, 2).map((category) => (
            <Tag key={category}>{category}</Tag>
          ))}
          {skill.tags.slice(0, 1).map((tag) => (
            <Tag key={tag}>#{tag}</Tag>
          ))}
        </div>
        {!installed ? (
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onInstall();
            }}
            disabled={installPending}
            aria-label={`安装 ${title}`}
            className="h-7 shrink-0 gap-1.5 px-2.5 text-2xs text-accent"
          >
            {installPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            安装
          </Button>
        ) : null}
      </div>
    </article>
  );
};

export default MarketSkillCard;
