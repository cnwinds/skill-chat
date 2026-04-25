import { Download, FileImage, ImagePlus, Share2 } from 'lucide-react';
import type { FileBucket, FileRecord, SkillMetadata } from '@skillchat/shared';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { formatBytes } from '@/lib/utils';
import { SkillCard } from './SkillCard';

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

export const InspectorPanel = ({
  inspectorTab,
  onTabChange,
  hasActiveSession,
  isWechat,
  groupedFiles,
  installedSkills,
  activeSkills,
  onDownloadFile,
  onShareFile,
  onReuseImage,
  onToggleSkill,
  toggleDisabled = false,
  sharePending = false,
}: InspectorPanelProps) => {
  const tabClass = (active: boolean) =>
    cn(
      'flex-1 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors',
      active
        ? 'bg-surface text-foreground shadow-sm'
        : 'text-foreground-muted hover:text-foreground',
    );
  return (
  <div className="flex h-full flex-col bg-background text-foreground">
    <div className="flex h-full flex-col">
      <div className="px-4 pt-4">
        <div className="flex w-full items-center gap-1 rounded-md bg-surface-hover p-1">
          <button
            type="button"
            className={tabClass(inspectorTab === 'files')}
            onClick={() => onTabChange('files')}
          >
            文件
          </button>
          <button
            type="button"
            className={tabClass(inspectorTab === 'skills')}
            onClick={() => onTabChange('skills')}
          >
            Skill
          </button>
        </div>
      </div>

      {inspectorTab === 'files' ? (
        <ScrollArea className="h-full px-4 pb-4 pt-3">
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
            <section key={bucket} className="mb-4 last:mb-0">
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-foreground-muted">
                {bucketLabels[bucket]}
              </h3>
              {(groupedFiles[bucket] ?? []).length === 0 ? (
                <div className="rounded-md border border-dashed border-border px-3 py-3 text-xs text-foreground-muted">
                  暂无文件
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {(groupedFiles[bucket] ?? []).map((file) => (
                    <article
                      key={file.id}
                      className="flex items-start justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2"
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <div className="flex items-center gap-1.5 text-sm">
                          <FileImage className="h-3.5 w-3.5 shrink-0 text-foreground-muted" />
                          <span className="truncate font-medium">{file.displayName}</span>
                        </div>
                        <div className="text-2xs text-foreground-muted">
                          {file.mimeType ?? 'application/octet-stream'} · {formatBytes(file.size)}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-0.5">
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
        </ScrollArea>
      ) : (
        <ScrollArea className="h-full px-4 pb-4 pt-3">
          <div
            className={cn(
              'mb-3 rounded-md border border-border bg-surface px-3 py-2 text-xs text-foreground-muted',
            )}
          >
            <div className="mb-0.5 text-sm font-medium text-foreground">
              {hasActiveSession ? '当前会话 Skill 作用域' : '已安装 Skills'}
            </div>
            {hasActiveSession
              ? activeSkills.length > 0
                ? `当前会话只允许使用这些 skills：${activeSkills.join(' · ')}。未启用的 skill 不会进入上下文，也不可调用。`
                : '当前会话未启用任何 skill。未启用的 skill 不会进入上下文，也不可调用。'
              : '项目中可以安装很多 skill，但只有加入当前会话的 skill 才会被读取、参考或执行。'}
          </div>
          <div className="grid gap-2">
            {installedSkills.map((skill) => (
              <SkillCard
                key={skill.name}
                skill={skill}
                selected={activeSkills.includes(skill.name)}
                disabled={toggleDisabled}
                onToggle={hasActiveSession ? () => onToggleSkill(skill.name) : undefined}
              />
            ))}
          </div>
          {installedSkills.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-foreground-muted">
              项目中还没有安装 skill。
            </div>
          ) : null}
        </ScrollArea>
      )}
    </div>
  </div>
  );
};

export default InspectorPanel;
