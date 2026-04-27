import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Check,
  Download,
  ExternalLink,
  Eye,
  FileImage,
  ImagePlus,
  Loader2,
  Package,
  RefreshCw,
  Search,
  Share2,
  Store,
  Trash2,
} from 'lucide-react';
import type { FileBucket, FileRecord, SkillMetadata } from '@skillchat/shared';
import { ApiError, api, type InstalledSkillRecord } from '@/lib/api';
import { useSkillMutations } from '@/hooks/useSkillMutations';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatBytes } from '@/lib/utils';
import { imagePreviewActions } from '@/hooks/useImagePreview';

export interface InspectorPanelProps {
  inspectorTab: 'files' | 'skills';
  onTabChange: (tab: 'files' | 'skills') => void;
  hasActiveSession: boolean;
  isWechat: boolean;
  groupedFiles: Partial<Record<FileBucket, FileRecord[]>>;
  installedSkills: SkillMetadata[];
  activeSkills: string[];
  onDownloadFile: (file: FileRecord) => void;
  onShareFile: (fileId: string) => void;
  onReuseImage: (file: FileRecord) => void;
  onToggleSkill: (skillName: string) => void;
  toggleDisabled?: boolean;
  sharePending?: boolean;
}

const buckets: FileBucket[] = ['uploads', 'outputs', 'shared'];

const bucketLabels: Record<FileBucket, string> = {
  uploads: '上传',
  outputs: '生成',
  shared: '共享',
};

const runtimeLabels: Record<InstalledSkillRecord['manifest']['runtime']['type'], string> = {
  none: '无脚本',
  python: 'Python',
  node: 'Node',
  shell: 'Shell',
};

const normalizeSearch = (value: string) => value.trim().toLowerCase();

const matchesText = (query: string, values: Array<string | undefined>) => {
  if (!query) return true;
  return values.some((value) => value?.toLowerCase().includes(query));
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

const SkillListLoading = () => (
  <div className="grid min-w-0 gap-2">
    {[0, 1, 2].map((item) => (
      <div
        key={item}
        className="h-[84px] min-w-0 animate-pulse rounded-md border border-border bg-surface"
      />
    ))}
  </div>
);

const SkillEmptyState = ({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}) => (
  <div className="flex min-w-0 max-w-full flex-col items-center gap-3 rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-foreground-muted">
    <div className="min-w-0 max-w-full break-words">{children}</div>
    {action}
  </div>
);

const SkillQueryError = ({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) => (
  <div className="flex min-w-0 max-w-full flex-col gap-3 rounded-md border border-danger/40 bg-danger/5 px-3 py-3 text-xs text-foreground-muted">
    <div className="break-words text-danger">{message}</div>
    <Button variant="outline" size="sm" onClick={onRetry} className="h-7 self-start px-2 text-2xs">
      <RefreshCw className="h-3.5 w-3.5" />
      重试
    </Button>
  </div>
);

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof ApiError || error instanceof Error ? error.message : fallback;

const InstalledSkillCard = ({
  record,
  active,
  hasActiveSession,
  toggleDisabled,
  uninstallPending,
  onToggle,
  onUninstall,
  onOpenDetail,
}: {
  record: InstalledSkillRecord;
  active: boolean;
  hasActiveSession: boolean;
  toggleDisabled: boolean;
  uninstallPending: boolean;
  onToggle: () => void;
  onUninstall: () => void;
  onOpenDetail: () => void;
}) => {
  const runtimeType = record.manifest.runtime.type;
  const title = record.manifest.displayName ?? record.id;

  return (
    <article
      className={cn(
        'flex w-full min-w-0 max-w-full flex-col gap-1.5 overflow-hidden rounded-md border bg-surface px-2.5 py-2.5 transition-colors',
        active ? 'border-accent/60 bg-accent/5' : 'border-border hover:border-border-strong',
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <span
            className={cn(
              'mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border',
              active
                ? 'border-accent bg-accent text-accent-foreground'
                : 'border-border text-foreground-muted',
            )}
          >
            {active ? <Check className="h-3.5 w-3.5" /> : <Package className="h-3.5 w-3.5" />}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground" title={title}>
              {title}
            </div>
            <div
              className="truncate text-2xs text-foreground-muted"
              title={`${record.id}@${record.version}`}
            >
              {record.id}@{record.version}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onOpenDetail}
            aria-label={`查看 ${record.id} 详情`}
            title="查看详情"
            className="h-7 w-7 text-foreground-muted hover:text-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onUninstall}
            disabled={uninstallPending}
            aria-label={`卸载 Skill：${record.id}`}
            title="卸载"
            className="h-7 w-7 text-foreground-muted hover:text-danger"
          >
            {uninstallPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>

      <p className="line-clamp-2 overflow-hidden break-words text-xs leading-5 text-foreground-muted">
        {record.manifest.description}
      </p>

      <div className="flex min-w-0 max-w-full flex-wrap gap-1 overflow-hidden">
        {runtimeType !== 'none' ? <Tag>{runtimeLabels[runtimeType]}</Tag> : null}
        {record.manifest.permissions.scripts ? (
          <Tag className="border-amber-500/30 text-amber-500">脚本</Tag>
        ) : null}
        {active ? <Tag className="border-accent/40 text-accent">已启用</Tag> : null}
      </div>

      {hasActiveSession ? (
        <div className="flex min-w-0 justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={onToggle}
            disabled={toggleDisabled}
            aria-label={`${active ? '停用' : '启用'} Skill：${record.id}`}
            className={cn('h-7 px-2 text-2xs', !active && 'text-accent')}
          >
            {active ? '停用' : '启用'}
          </Button>
        </div>
      ) : null}
    </article>
  );
};

export const InspectorPanel = ({
  inspectorTab,
  onTabChange,
  hasActiveSession,
  isWechat,
  groupedFiles,
  activeSkills,
  onDownloadFile,
  onShareFile,
  onReuseImage,
  onToggleSkill,
  toggleDisabled = false,
  sharePending = false,
}: InspectorPanelProps) => {
  const navigate = useNavigate();
  const [skillSearch, setSkillSearch] = useState('');
  const normalizedSkillSearch = normalizeSearch(skillSearch);

  const userInstalledSkillsQuery = useQuery({
    queryKey: ['user-installed-skills'],
    queryFn: api.listInstalledSkills,
    enabled: inspectorTab === 'skills',
    staleTime: 10_000,
  });

  const { uninstallMutation } = useSkillMutations();

  const userInstalledRecords = userInstalledSkillsQuery.data ?? [];

  // Sort: active first (preserving activeSkills order), then alphabetical by displayName
  const sortedRecords = useMemo(() => {
    const activeSet = new Set(activeSkills);
    return [...userInstalledRecords].sort((a, b) => {
      const aActive = activeSet.has(a.id);
      const bActive = activeSet.has(b.id);
      if (aActive && !bActive) return -1;
      if (!aActive && bActive) return 1;
      const aTitle = (a.manifest.displayName ?? a.id).toLowerCase();
      const bTitle = (b.manifest.displayName ?? b.id).toLowerCase();
      return aTitle.localeCompare(bTitle);
    });
  }, [userInstalledRecords, activeSkills]);

  const filteredRecords = useMemo(
    () =>
      sortedRecords.filter((record) =>
        matchesText(normalizedSkillSearch, [
          record.id,
          record.manifest.displayName,
          record.manifest.description,
          record.manifest.author.name,
          ...record.manifest.tags,
          ...record.manifest.categories,
        ]),
      ),
    [sortedRecords, normalizedSkillSearch],
  );

  const tabClass = (active: boolean) =>
    cn(
      'flex-1 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors',
      active
        ? 'bg-surface text-foreground shadow-sm'
        : 'text-foreground-muted hover:text-foreground',
    );

  const renderSkillContent = () => {
    if (userInstalledSkillsQuery.isLoading) {
      return <SkillListLoading />;
    }

    if (userInstalledSkillsQuery.isError) {
      return (
        <SkillQueryError
          message={getErrorMessage(userInstalledSkillsQuery.error, '获取已安装 Skill 失败')}
          onRetry={() => void userInstalledSkillsQuery.refetch()}
        />
      );
    }

    if (userInstalledRecords.length === 0) {
      return (
        <SkillEmptyState>
          还没有安装任何 Skill。前往市场浏览并安装。
        </SkillEmptyState>
      );
    }

    if (filteredRecords.length === 0) {
      return <SkillEmptyState>没有匹配的 Skill。</SkillEmptyState>;
    }

    return (
      <div className="grid min-w-0 gap-2">
        {filteredRecords.map((record) => {
          const [publisher, name] = record.id.split('/');
          return (
            <InstalledSkillCard
              key={`${record.id}@${record.version}`}
              record={record}
              active={activeSkills.includes(record.id)}
              hasActiveSession={hasActiveSession}
              toggleDisabled={toggleDisabled}
              uninstallPending={
                uninstallMutation.isPending &&
                uninstallMutation.variables?.id === record.id &&
                uninstallMutation.variables?.version === record.version
              }
              onToggle={() => onToggleSkill(record.id)}
              onUninstall={() =>
                uninstallMutation.mutate({ id: record.id, version: record.version })
              }
              onOpenDetail={() => {
                if (publisher && name) {
                  navigate(`/app/market/${publisher}/${name}`);
                }
              }}
            />
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-background text-foreground">
      <div className="flex h-full min-w-0 flex-col overflow-hidden">
        {/* 顶部标签：文件 / Skill */}
        <div className="min-w-0 px-4 pt-4">
          <div className="flex w-full min-w-0 items-center gap-1 rounded-md bg-surface-hover p-1">
            <button
              type="button"
              className={cn(tabClass(inspectorTab === 'files'), 'min-w-0')}
              onClick={() => onTabChange('files')}
            >
              文件
            </button>
            <button
              type="button"
              className={cn(tabClass(inspectorTab === 'skills'), 'min-w-0')}
              onClick={() => onTabChange('skills')}
            >
              Skill
            </button>
          </div>
        </div>

        {inspectorTab === 'files' ? (
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 pb-4 pt-3">
            {isWechat ? (
              <div className="mb-3 rounded-md border border-border bg-surface px-3 py-2 text-xs text-foreground-muted">
                微信内若下载受限，请点击文件后在系统浏览器中打开或使用桌面端下载。
              </div>
            ) : null}
            {!hasActiveSession ? (
              <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-foreground-muted">
                先进入一个会话，当前会话的文件才会显示在这里。
              </div>
            ) : null}
            {buckets.map((bucket) => (
              <section key={bucket} className="mb-4 min-w-0 max-w-full last:mb-0">
                <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-foreground-muted">
                  {bucketLabels[bucket]}
                </h3>
                {(groupedFiles[bucket] ?? []).length === 0 ? (
                  <div className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-foreground-muted">
                    暂无文件
                  </div>
                ) : (
                  <div className="flex min-w-0 max-w-full flex-col gap-1.5">
                    {(groupedFiles[bucket] ?? []).map((file) => (
                      <article
                        key={file.id}
                        className="flex w-full min-w-0 max-w-full flex-col gap-1.5 overflow-hidden rounded-md border border-border bg-surface px-3 py-2"
                      >
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <div className="flex min-w-0 items-center gap-1.5 text-sm">
                            <FileImage className="h-3.5 w-3.5 shrink-0 text-foreground-muted" />
                            <span className="min-w-0 truncate font-medium" title={file.displayName}>
                              {file.displayName}
                            </span>
                          </div>
                          <div className="truncate text-2xs text-foreground-muted">
                            {file.mimeType ?? 'application/octet-stream'} · {formatBytes(file.size)}
                          </div>
                        </div>
                        <div className="flex w-full min-w-0 max-w-full flex-wrap justify-end gap-0.5 overflow-hidden">
                          {file.mimeType?.startsWith('image/') ? (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() =>
                                imagePreviewActions.open({
                                  id: file.id,
                                  file,
                                  label: file.displayName,
                                  mimeType: file.mimeType,
                                })
                              }
                              aria-label="预览"
                              title="预览大图"
                            >
                              <Eye className="h-3.5 w-3.5" />
                            </Button>
                          ) : null}
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => onDownloadFile(file)}
                            aria-label="下载"
                            title="下载"
                          >
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                          {bucket !== 'shared' ? (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => onShareFile(file.id)}
                              disabled={sharePending}
                              aria-label="共享"
                              title="共享"
                            >
                              <Share2 className="h-3.5 w-3.5" />
                            </Button>
                          ) : null}
                          {file.mimeType?.startsWith('image/') && hasActiveSession ? (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => onReuseImage(file)}
                              aria-label="重用图片"
                              title="重用为聊天附件"
                            >
                              <ImagePlus className="h-3.5 w-3.5" />
                            </Button>
                          ) : null}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        ) : (
          <ScrollArea className="min-h-0 flex-1 px-3 pb-4 pt-3">
            <div className="flex min-w-0 max-w-full flex-col gap-3">
              {/* 搜索 + 计数 + 刷新 */}
              <div className="flex min-w-0 items-center gap-1.5">
                <label className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-muted" />
                  <Input
                    aria-label="搜索 Skill"
                    value={skillSearch}
                    onChange={(event) => setSkillSearch(event.target.value)}
                    placeholder="搜索 Skill…"
                    className="h-8 pl-8 pr-2 text-xs focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-accent/60"
                  />
                </label>
                <span className="inline-flex h-8 shrink-0 items-center rounded-sm bg-surface-hover px-1.5 text-2xs text-foreground-muted">
                  {activeSkills.length}/{userInstalledRecords.length}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void userInstalledSkillsQuery.refetch()}
                  aria-label="刷新 Skill 列表"
                  title="刷新"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>

              {/* Skill 列表 */}
              {renderSkillContent()}

              {/* 浏览市场 CTA */}
              <Button
                variant="outline"
                className="mt-1 w-full gap-2 text-xs text-foreground-muted"
                onClick={() => navigate('/app/market')}
              >
                <Store className="h-3.5 w-3.5" />
                浏览技能市场
              </Button>
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
};

export default InspectorPanel;
