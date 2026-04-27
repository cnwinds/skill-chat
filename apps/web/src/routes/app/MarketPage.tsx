import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw, Search, Store } from 'lucide-react';
import { api, type MarketSkillSummary } from '@/lib/api';
import { useSkillMutations } from '@/hooks/useSkillMutations';
import { ChatHeader } from '@/components/layout/ChatHeader';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { MarketSkillCard } from '@/components/market/MarketSkillCard';
import { cn } from '@/lib/cn';
import { useAppShellOutlet } from './AppShellContext';

type KindFilter = 'all' | 'instruction' | 'runtime' | 'hybrid';

const kindFilterLabels: Record<KindFilter, string> = {
  all: '全部',
  instruction: '指令',
  runtime: '运行时',
  hybrid: '混合',
};

const normalizeSearch = (value: string) => value.trim().toLowerCase();

const matchesText = (query: string, values: Array<string | undefined>) => {
  if (!query) return true;
  return values.some((value) => value?.toLowerCase().includes(query));
};

const SkillCardSkeleton = () => (
  <div className="h-[148px] animate-pulse rounded-lg border border-border bg-surface" />
);

const MarketPage = () => {
  const navigate = useNavigate();
  const { themeMode, onToggleTheme, openSidebarSheet, openInspectorSheet } = useAppShellOutlet();
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');

  const marketSkillsQuery = useQuery({
    queryKey: ['market-skills'],
    queryFn: api.listMarketSkills,
    staleTime: 30_000,
  });

  const installedSkillsQuery = useQuery({
    queryKey: ['user-installed-skills'],
    queryFn: api.listInstalledSkills,
    staleTime: 10_000,
  });

  const { installMutation } = useSkillMutations();

  const installedSkillIds = useMemo(
    () => new Set((installedSkillsQuery.data ?? []).map((r) => r.id)),
    [installedSkillsQuery.data],
  );

  const normalizedSearch = normalizeSearch(search);

  const filteredSkills = useMemo(() => {
    const skills = marketSkillsQuery.data ?? [];
    return skills.filter((skill) => {
      if (kindFilter !== 'all' && skill.kind !== kindFilter) return false;
      return matchesText(normalizedSearch, [
        skill.id,
        skill.displayName,
        skill.description,
        skill.author.name,
        ...skill.tags,
        ...skill.categories,
      ]);
    });
  }, [marketSkillsQuery.data, kindFilter, normalizedSearch]);

  const handleCardClick = (skill: MarketSkillSummary) => {
    const [publisher, name] = skill.id.split('/');
    if (publisher && name) {
      navigate(`/app/market/${publisher}/${name}`);
    }
  };

  const renderContent = () => {
    if (marketSkillsQuery.isLoading) {
      return (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <SkillCardSkeleton key={i} />
          ))}
        </div>
      );
    }

    if (marketSkillsQuery.isError) {
      return (
        <div className="flex flex-col items-center gap-4 rounded-lg border border-danger/30 bg-danger/5 px-6 py-10 text-center">
          <p className="text-sm text-danger">加载市场数据失败，请重试。</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void marketSkillsQuery.refetch()}
            className="gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            重试
          </Button>
        </div>
      );
    }

    if (filteredSkills.length === 0) {
      return (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-12 text-center">
          <Store className="h-8 w-8 text-foreground-muted/40" />
          <p className="text-sm text-foreground-muted">
            {search || kindFilter !== 'all' ? '没有匹配的 Skill。' : '市场暂时没有可安装的 Skill。'}
          </p>
          {search || kindFilter !== 'all' ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearch('');
                setKindFilter('all');
              }}
              className="text-xs text-foreground-muted"
            >
              清除筛选
            </Button>
          ) : null}
        </div>
      );
    }

    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {filteredSkills.map((skill) => (
          <MarketSkillCard
            key={skill.id}
            skill={skill}
            installed={installedSkillIds.has(skill.id)}
            installPending={installMutation.isPending && installMutation.variables?.id === skill.id}
            onInstall={() => installMutation.mutate({ id: skill.id })}
            onClick={() => handleCardClick(skill)}
          />
        ))}
      </div>
    );
  };

  return (
    <main className="flex h-full min-h-0 flex-1 flex-col">
      <ChatHeader
        title="技能市场"
        subtitle="浏览并安装 Skill"
        themeMode={themeMode}
        onToggleTheme={onToggleTheme}
        onOpenSidebar={openSidebarSheet}
        onOpenInspector={() => openInspectorSheet('skills')}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
          {/* 搜索与筛选 */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <label className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-foreground-muted" />
              <Input
                aria-label="搜索技能市场"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="搜索 Skill 名称、描述、标签…"
                className="h-9 pl-9 pr-3 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-accent/60"
              />
            </label>
            <div className="flex shrink-0 items-center gap-1 rounded-md bg-surface-hover p-1">
              {(Object.keys(kindFilterLabels) as KindFilter[]).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  onClick={() => setKindFilter(kind)}
                  className={cn(
                    'rounded-sm px-2.5 py-1 text-xs font-medium transition-colors',
                    kindFilter === kind
                      ? 'bg-surface text-foreground shadow-sm'
                      : 'text-foreground-muted hover:text-foreground',
                  )}
                >
                  {kindFilterLabels[kind]}
                </button>
              ))}
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => void marketSkillsQuery.refetch()}
              aria-label="刷新市场列表"
              title="刷新"
            >
              <RefreshCw className={cn('h-4 w-4', marketSkillsQuery.isFetching && 'animate-spin')} />
            </Button>
          </div>

          {/* 结果统计 */}
          {!marketSkillsQuery.isLoading && !marketSkillsQuery.isError && (
            <div className="text-xs text-foreground-muted">
              {filteredSkills.length} 个 Skill
              {(search || kindFilter !== 'all') &&
                marketSkillsQuery.data &&
                filteredSkills.length !== marketSkillsQuery.data.length
                ? `（共 ${marketSkillsQuery.data.length} 个，已筛选）`
                : ''}
            </div>
          )}

          {renderContent()}
        </div>
      </div>
    </main>
  );
};

export default MarketPage;
