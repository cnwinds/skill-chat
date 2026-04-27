import { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  Download,
  ExternalLink,
  FileCode2,
  Globe,
  Loader2,
  Lock,
  Package,
  RefreshCw,
  Terminal,
  Trash2,
  Zap,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useSkillMutations } from '@/hooks/useSkillMutations';
import { ChatHeader } from '@/components/layout/ChatHeader';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import { useAppShellOutlet } from './AppShellContext';

const skillKindLabels = {
  instruction: '指令',
  runtime: '运行时',
  hybrid: '混合',
} as const;

const runtimeLabels = {
  none: '无脚本',
  python: 'Python',
  node: 'Node',
  shell: 'Shell',
} as const;

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-foreground-muted">
    {children}
  </h2>
);

const InfoBadge = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <span
    className={cn(
      'inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-0.5 text-xs text-foreground-muted',
      className,
    )}
  >
    {children}
  </span>
);

const MarketDetailPage = () => {
  const navigate = useNavigate();
  const { publisher, name } = useParams<{ publisher: string; name: string }>();
  const { themeMode, onToggleTheme, openSidebarSheet, openInspectorSheet, activeSkills, hasActiveSession, onToggleSkill, toggleSkillPending } =
    useAppShellOutlet();

  const skillId = publisher && name ? `${publisher}/${name}` : '';

  const detailQuery = useQuery({
    queryKey: ['market-skill-detail', skillId],
    queryFn: () => api.getMarketSkillDetail(skillId),
    enabled: Boolean(skillId),
    staleTime: 60_000,
  });

  const installedSkillsQuery = useQuery({
    queryKey: ['user-installed-skills'],
    queryFn: api.listInstalledSkills,
    staleTime: 10_000,
  });

  const { installMutation, uninstallMutation } = useSkillMutations();

  const installedRecord = useMemo(
    () => (installedSkillsQuery.data ?? []).find((r) => r.id === skillId) ?? null,
    [installedSkillsQuery.data, skillId],
  );
  const isInstalled = Boolean(installedRecord);
  const isActive = activeSkills.includes(skillId);

  const manifest = detailQuery.data?.manifest;
  const permissions = manifest?.permissions;
  const runtime = manifest?.runtime;

  const handleBack = () => {
    navigate('/app/market');
  };

  const renderHeaderActions = () => (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleBack}
      className="h-7 gap-1.5 px-2 text-xs text-foreground-muted"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      返回市场
    </Button>
  );

  if (!skillId) {
    return (
      <main className="flex h-full min-h-0 flex-1 flex-col">
        <ChatHeader
          title="Skill 详情"
          themeMode={themeMode}
          onToggleTheme={onToggleTheme}
          onOpenSidebar={openSidebarSheet}
          onOpenInspector={() => openInspectorSheet('skills')}
          titleActions={renderHeaderActions()}
        />
        <div className="flex flex-1 items-center justify-center text-sm text-foreground-muted">
          无效的 Skill ID。
        </div>
      </main>
    );
  }

  if (detailQuery.isLoading) {
    return (
      <main className="flex h-full min-h-0 flex-1 flex-col">
        <ChatHeader
          title={name ?? 'Skill 详情'}
          themeMode={themeMode}
          onToggleTheme={onToggleTheme}
          onOpenSidebar={openSidebarSheet}
          onOpenInspector={() => openInspectorSheet('skills')}
          titleActions={renderHeaderActions()}
        />
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-foreground-muted">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载中…
        </div>
      </main>
    );
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <main className="flex h-full min-h-0 flex-1 flex-col">
        <ChatHeader
          title={name ?? 'Skill 详情'}
          themeMode={themeMode}
          onToggleTheme={onToggleTheme}
          onOpenSidebar={openSidebarSheet}
          onOpenInspector={() => openInspectorSheet('skills')}
          titleActions={renderHeaderActions()}
        />
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <p className="text-sm text-danger">加载 Skill 详情失败。</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void detailQuery.refetch()}
            className="gap-1.5"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            重试
          </Button>
        </div>
      </main>
    );
  }

  const detail = detailQuery.data;
  const title = manifest?.displayName ?? skillId;
  const authorLine = manifest?.author.name
    ? `by ${manifest.author.name}`
    : null;

  return (
    <main className="flex h-full min-h-0 flex-1 flex-col">
      <ChatHeader
        title={title}
        subtitle={
          <span className="flex items-center gap-1.5 text-foreground-muted">
            <span className="font-mono">{skillId}@{detail.version}</span>
            {authorLine ? <span>· {authorLine}</span> : null}
          </span>
        }
        themeMode={themeMode}
        onToggleTheme={onToggleTheme}
        onOpenSidebar={openSidebarSheet}
        onOpenInspector={() => openInspectorSheet('skills')}
        titleActions={renderHeaderActions()}
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl p-4 sm:p-6">
          {/* 标题卡：徽章 + 主操作 */}
          <div className="mb-6 flex flex-col gap-4 rounded-lg border border-border bg-surface px-4 py-4">
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-wrap gap-1.5">
                {manifest?.kind ? (
                  <InfoBadge className="border-accent/30 text-accent">
                    <Zap className="h-3 w-3" />
                    {skillKindLabels[manifest.kind]}
                  </InfoBadge>
                ) : null}
                {runtime?.type && runtime.type !== 'none' ? (
                  <InfoBadge>
                    <Terminal className="h-3 w-3" />
                    {runtimeLabels[runtime.type]}
                  </InfoBadge>
                ) : null}
                {isInstalled && installedRecord ? (
                  <InfoBadge className="border-emerald-500/30 text-emerald-500">
                    <Check className="h-3 w-3" />
                    已安装 v{installedRecord.version}
                  </InfoBadge>
                ) : null}
                {isActive ? (
                  <InfoBadge className="border-accent/40 bg-accent/10 text-accent">
                    <Check className="h-3 w-3" />
                    当前会话已启用
                  </InfoBadge>
                ) : null}
              </div>

              {/* 操作按钮组 */}
              <div className="flex shrink-0 items-center gap-2">
                {hasActiveSession && isInstalled ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onToggleSkill(skillId)}
                    disabled={toggleSkillPending}
                    className={cn('h-8 gap-1.5 px-3 text-xs', !isActive && 'text-accent')}
                  >
                    {toggleSkillPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : isActive ? (
                      <Check className="h-3.5 w-3.5" />
                    ) : (
                      <Package className="h-3.5 w-3.5" />
                    )}
                    {isActive ? '停用' : '启用'}
                  </Button>
                ) : null}

                {isInstalled && installedRecord ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      uninstallMutation.mutate({ id: skillId, version: installedRecord.version })
                    }
                    disabled={
                      uninstallMutation.isPending &&
                      uninstallMutation.variables?.id === skillId
                    }
                    className="h-8 gap-1.5 px-3 text-xs text-foreground-muted hover:text-danger"
                  >
                    {uninstallMutation.isPending && uninstallMutation.variables?.id === skillId ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                    卸载
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    onClick={() => installMutation.mutate({ id: skillId })}
                    disabled={installMutation.isPending && installMutation.variables?.id === skillId}
                    className="h-8 gap-1.5 px-3 text-xs"
                  >
                    {installMutation.isPending && installMutation.variables?.id === skillId ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    安装
                  </Button>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            {/* 描述 */}
            {manifest?.description ? (
              <section>
                <SectionTitle>描述</SectionTitle>
                <div className="rounded-lg border border-border bg-surface px-4 py-3">
                  <p className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">
                    {manifest.description}
                  </p>
                </div>
              </section>
            ) : null}

            {/* 权限 */}
            {permissions ? (
              <section>
                <SectionTitle>权限</SectionTitle>
                <div className="rounded-lg border border-border bg-surface divide-y divide-border">
                  {/* 文件系统 */}
                  <div className="flex items-start gap-3 px-4 py-3">
                    <FileCode2 className="mt-0.5 h-4 w-4 shrink-0 text-foreground-muted" />
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-foreground">文件系统</div>
                      {permissions.filesystem.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {permissions.filesystem.map((p) => (
                            <span
                              key={p}
                              className="rounded-sm border border-border bg-background px-1.5 py-0.5 font-mono text-2xs text-foreground-muted"
                            >
                              {p}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-0.5 text-xs text-foreground-muted">无权限</div>
                      )}
                    </div>
                  </div>

                  {/* 网络 */}
                  <div className="flex items-start gap-3 px-4 py-3">
                    <Globe className="mt-0.5 h-4 w-4 shrink-0 text-foreground-muted" />
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-foreground">网络</div>
                      <div className="mt-0.5 text-xs text-foreground-muted">
                        {permissions.network === false ? (
                          '无网络访问'
                        ) : permissions.network === true ? (
                          '允许所有主机'
                        ) : (
                          <span>
                            允许主机：
                            {(permissions.network as { allowedHosts: string[] }).allowedHosts.join(
                              '、',
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* 脚本 */}
                  <div className="flex items-start gap-3 px-4 py-3">
                    <Terminal className="mt-0.5 h-4 w-4 shrink-0 text-foreground-muted" />
                    <div className="min-w-0">
                      <div className="text-xs font-medium text-foreground">脚本</div>
                      <div
                        className={cn(
                          'mt-0.5 text-xs',
                          permissions.scripts ? 'text-amber-500' : 'text-foreground-muted',
                        )}
                      >
                        {permissions.scripts ? '需要执行脚本权限' : '不执行脚本'}
                      </div>
                    </div>
                  </div>

                  {/* 密钥 */}
                  {permissions.secrets.length > 0 ? (
                    <div className="flex items-start gap-3 px-4 py-3">
                      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-foreground-muted" />
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-foreground">所需密钥</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {permissions.secrets.map((s) => (
                            <span
                              key={s}
                              className="rounded-sm border border-border bg-background px-1.5 py-0.5 font-mono text-2xs text-foreground-muted"
                            >
                              {s}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}

            {/* 运行时入口 */}
            {runtime && runtime.type !== 'none' && runtime.entrypoints.length > 0 ? (
              <section>
                <SectionTitle>运行时入口</SectionTitle>
                <div className="flex flex-col gap-2">
                  {runtime.entrypoints.map((entry) => (
                    <div
                      key={entry.path}
                      className="rounded-lg border border-border bg-surface px-4 py-3"
                    >
                      <div className="flex items-center gap-2">
                        <Terminal className="h-3.5 w-3.5 shrink-0 text-foreground-muted" />
                        <span className="text-sm font-medium text-foreground">{entry.name}</span>
                        <span className="font-mono text-2xs text-foreground-muted">{entry.path}</span>
                      </div>
                      {entry.description ? (
                        <p className="mt-1 text-xs text-foreground-muted">{entry.description}</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {/* 起始提示 */}
            {manifest?.starterPrompts && manifest.starterPrompts.length > 0 ? (
              <section>
                <SectionTitle>起始提示</SectionTitle>
                <div className="flex flex-col gap-1.5">
                  {manifest.starterPrompts.map((prompt, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-border bg-surface px-3 py-2.5 text-xs leading-5 text-foreground"
                    >
                      {prompt}
                    </div>
                  ))}
                </div>
              </section>
            ) : null}

            {/* 标签与分类 */}
            {manifest && (manifest.categories.length > 0 || manifest.tags.length > 0) ? (
              <section>
                <SectionTitle>标签与分类</SectionTitle>
                <div className="flex flex-wrap gap-1.5">
                  {manifest.categories.map((c) => (
                    <span
                      key={c}
                      className="rounded-md border border-border bg-surface px-2 py-0.5 text-xs text-foreground-muted"
                    >
                      {c}
                    </span>
                  ))}
                  {manifest.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-md border border-border bg-surface px-2 py-0.5 text-xs text-foreground-muted"
                    >
                      #{t}
                    </span>
                  ))}
                </div>
              </section>
            ) : null}

            {/* 元信息 */}
            <section>
              <SectionTitle>信息</SectionTitle>
              <div className="rounded-lg border border-border bg-surface divide-y divide-border text-xs">
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-foreground-muted">版本</span>
                  <span className="font-mono text-foreground">{detail.version}</span>
                </div>
                {manifest?.author.name ? (
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-foreground-muted">作者</span>
                    <div className="flex items-center gap-1.5 text-foreground">
                      {manifest.author.name}
                      {manifest.author.url ? (
                        <a
                          href={manifest.author.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-foreground-muted hover:text-accent"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : null}
                    </div>
                  </div>
                ) : null}
                {manifest?.license ? (
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-foreground-muted">许可证</span>
                    <span className="text-foreground">{manifest.license}</span>
                  </div>
                ) : null}
                {manifest?.homepage ? (
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-foreground-muted">主页</span>
                    <a
                      href={manifest.homepage}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-accent hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink className="h-3 w-3" />
                      查看
                    </a>
                  </div>
                ) : null}
                {manifest?.repository ? (
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-foreground-muted">源码</span>
                    <a
                      href={manifest.repository}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-accent hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <ExternalLink className="h-3 w-3" />
                      仓库
                    </a>
                  </div>
                ) : null}
                <div className="flex items-center justify-between px-4 py-2.5">
                  <span className="text-foreground-muted">发布时间</span>
                  <span className="text-foreground">
                    {new Date(detail.publishedAt).toLocaleDateString('zh-CN')}
                  </span>
                </div>
                {detail.sizeBytes ? (
                  <div className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-foreground-muted">包大小</span>
                    <span className="text-foreground">
                      {(detail.sizeBytes / 1024).toFixed(1)} KB
                    </span>
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
};

export default MarketDetailPage;
