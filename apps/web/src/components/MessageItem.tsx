import { Children, isValidElement, useEffect, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertCircle,
  ChevronDown,
  Check,
  Copy,
  Download,
  ExternalLink,
  FileText,
  FolderOpen,
  Globe,
  ImagePlus,
  Loader2,
  Search,
  Terminal,
  Wrench,
} from 'lucide-react';
import type {
  AssistantMessageMeta,
  FileRecord,
  StoredEvent,
  TokenUsageStats,
} from '@skillchat/shared';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/utils';
import type { ToolTraceDisplayEvent, ToolTraceGroupDisplayEvent } from '@/lib/timeline';
import { useFilePreviewUrl } from '@/hooks/useFilePreviewUrl';
import { imagePreviewActions } from '@/hooks/useImagePreview';
import { MessageAttachments } from '@/components/chat/MessageAttachments';

type Props = {
  event:
    | StoredEvent
    | ToolTraceDisplayEvent
    | ToolTraceGroupDisplayEvent
    | { kind: 'pending_text'; content: string };
  assistantMeta?: AssistantMessageMeta;
  onDownload?: (file: FileRecord) => void;
  onReuseImage?: (file: FileRecord) => void;
  downloading?: boolean;
  canExpandToolTrace?: boolean;
};

const formatSkillPathLabel = (path: string) => {
  const normalizedPath = path.replace(/\\/g, '/');
  const skillMatch = normalizedPath.match(/^skills\/([^/]+)\/SKILL\.md$/i);
  if (skillMatch) {
    return `${skillMatch[1]} / SKILL.md`;
  }
  const referenceMatch = normalizedPath.match(/^skills\/([^/]+)\/references\/(.+)$/i);
  if (referenceMatch) {
    return `${referenceMatch[1]} / references/${referenceMatch[2]}`;
  }
  return normalizedPath;
};

const formatToolName = (tool: string, args?: Record<string, unknown>) => {
  if (tool === 'read_workspace_path_slice') {
    const path = typeof args?.path === 'string' ? args.path : '';
    if (/(^|\/)SKILL\.md$/i.test(path)) {
      return '读取 Skill';
    }
    if (/(^|\/)references\//i.test(path)) {
      return '读取参考资料';
    }
    return '读取工作区文件';
  }

  const labels: Record<string, string> = {
    web_search: '搜索页面',
    web_fetch: '抓取网页',
    list_files: '列出文件',
    read_file: '读取文件',
    list_workspace_paths: '列出目录',
    write_artifact_file: '写入文件',
    run_workspace_script: '运行脚本',
  };

  return labels[tool] ?? tool;
};

const formatToolMessage = (tool: string, message: string, args?: Record<string, unknown>) => {
  if (tool !== 'read_workspace_path_slice') {
    return message;
  }
  const path = typeof args?.path === 'string' ? args.path : '';
  if (!path) {
    return message;
  }
  const label = formatSkillPathLabel(path);
  if (/(^|\/)SKILL\.md$/i.test(path)) {
    return `已读取 Skill 定义：${label}`;
  }
  if (/(^|\/)references\//i.test(path)) {
    return `已读取参考资料：${label}`;
  }
  if (message.startsWith('已读取')) {
    return `已读取工作区文件：${label}`;
  }
  return message;
};

const formatToolArguments = (tool: string, args?: Record<string, unknown>) => {
  if (!args) {
    return '';
  }
  if (tool !== 'read_workspace_path_slice') {
    return JSON.stringify(args, null, 2);
  }
  const formattedArgs = { ...args };
  if (typeof formattedArgs.path === 'string') {
    formattedArgs.path = formatSkillPathLabel(formattedArgs.path);
  }
  return JSON.stringify(formattedArgs, null, 2);
};

const getTextArg = (args: Record<string, unknown> | undefined, key: string) => {
  const value = args?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : '';
};

const isDefaultToolMessage = (message: string) =>
  message === '开始调用工具' || message === '任务执行中' || message === '工具执行完成';

const formatWorkspaceReadTarget = (args?: Record<string, unknown>) => {
  const path = getTextArg(args, 'path');
  if (!path) {
    return '';
  }
  const label = formatSkillPathLabel(path);
  if (/(^|\/)SKILL\.md$/i.test(path)) {
    return `读取 Skill 定义：${label}`;
  }
  if (/(^|\/)references\//i.test(path)) {
    return `读取参考资料：${label}`;
  }
  return `读取工作区文件：${label}`;
};

const formatToolWorkDescription = (event: ToolTraceDisplayEvent) => {
  const formattedMessage = formatToolMessage(event.tool, event.message, event.arguments);
  if (formattedMessage && !isDefaultToolMessage(formattedMessage)) {
    return formattedMessage;
  }

  if (event.tool === 'web_search') {
    return getTextArg(event.arguments, 'query')
      ? `搜索：${getTextArg(event.arguments, 'query')}`
      : formattedMessage;
  }
  if (event.tool === 'web_fetch') {
    return getTextArg(event.arguments, 'url')
      ? `抓取网页：${getTextArg(event.arguments, 'url')}`
      : formattedMessage;
  }
  if (event.tool === 'read_file') {
    const target = getTextArg(event.arguments, 'fileName') || getTextArg(event.arguments, 'fileId');
    return target ? `读取文件：${target}` : formattedMessage;
  }
  if (event.tool === 'list_files') {
    const bucket = getTextArg(event.arguments, 'bucket');
    return bucket ? `列出文件：${bucket}` : '列出文件';
  }
  if (event.tool === 'list_workspace_paths') {
    const path = getTextArg(event.arguments, 'path') || '.';
    return `列出目录：${path}`;
  }
  if (event.tool === 'read_workspace_path_slice') {
    return formatWorkspaceReadTarget(event.arguments) || formattedMessage;
  }
  if (event.tool === 'write_artifact_file') {
    const fileName = getTextArg(event.arguments, 'fileName');
    return fileName ? `写入文件：${fileName}` : formattedMessage;
  }
  if (event.tool === 'run_workspace_script') {
    const path = getTextArg(event.arguments, 'path');
    return path ? `运行脚本：${path}` : formattedMessage;
  }

  return formattedMessage || '调用工具';
};

const formatToolGroupCounts = (items: ToolTraceDisplayEvent[]) => {
  const counts = new Map<string, number>();
  for (const item of items) {
    const label = formatToolName(item.tool, item.arguments);
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([label, count]) => `${label} ${count} 次`)
    .join('、');
};

const toolStatusLabel: Record<ToolTraceDisplayEvent['status'], string> = {
  queued: '排队中',
  running: '执行中',
  success: '已完成',
  failed: '失败',
};

const toolStatusToneClass: Record<ToolTraceDisplayEvent['status'], string> = {
  queued: 'bg-foreground-muted/15 text-foreground-muted',
  running: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  success: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  failed: 'bg-danger/15 text-danger',
};

const getElapsedSeconds = (createdAt: string) => {
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) {
    return 0;
  }
  return Math.max(0, Math.floor((Date.now() - created) / 1000));
};

const formatElapsedDuration = (elapsedSeconds: number) => {
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}秒`;
  }
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return `${minutes}分钟${seconds}秒`;
};

const getThinkingBubbleLabel = (content: string) =>
  /^重连中\d+\/\d+$/.test(content) ? content : '思考中';

const formatCompactTokenCount = (value: number) => {
  if (!Number.isFinite(value)) {
    return '0';
  }

  const absValue = Math.abs(value);
  const formatScaled = (scaled: number, unit: 'K' | 'M') =>
    `${scaled.toFixed(2).replace(/\.?0+$/, '')}${unit}`;

  if (absValue >= 1_000_000) {
    return formatScaled(value / 1_000_000, 'M');
  }

  if (absValue >= 1_000) {
    return formatScaled(value / 1_000, 'K');
  }

  return String(value);
};

const formatTokenUsage = (tokenUsage?: TokenUsageStats) => {
  if (!tokenUsage) {
    return '';
  }
  return `${formatCompactTokenCount(tokenUsage.totalTokens)} (${formatCompactTokenCount(tokenUsage.inputTokens)}/${formatCompactTokenCount(tokenUsage.outputTokens)}) tokens`;
};

const formatDurationMs = (durationMs?: number) => {
  if (!durationMs || durationMs <= 0) {
    return '';
  }
  if (durationMs < 1_000) {
    return `${durationMs}ms`;
  }
  if (durationMs < 60_000) {
    return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
  }
  const totalSeconds = Math.round(durationMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
};

const AssistantMetaFooter = ({ meta }: { meta?: AssistantMessageMeta }) => {
  const metrics = [
    formatTokenUsage(meta?.tokenUsage),
    formatDurationMs(meta?.durationMs),
  ].filter(Boolean);

  if (metrics.length === 0 && !meta?.reasoningSummary) {
    return null;
  }

  return (
    <div className="mt-2 flex flex-col gap-1 text-2xs text-foreground-muted">
      {meta?.reasoningSummary ? (
        <div className="flex flex-col gap-0.5 rounded-md border border-border bg-surface px-2.5 py-2">
          <strong className="text-xs font-semibold text-foreground">推理摘要</strong>
          <span className="leading-5">{meta.reasoningSummary}</span>
        </div>
      ) : null}
      {metrics.length > 0 ? <div>{metrics.join(' · ')}</div> : null}
    </div>
  );
};

const ImageEventCard = ({
  event,
  onDownload,
  onReuseImage,
  downloading,
}: {
  event: Extract<StoredEvent, { kind: 'image' }>;
  onDownload?: (file: FileRecord) => void;
  onReuseImage?: (file: FileRecord) => void;
  downloading: boolean;
}) => {
  const { previewUrl, loading, error } = useFilePreviewUrl(
    event.file,
    event.file.mimeType?.startsWith('image/') === true,
  );

  const openLightbox = () => {
    imagePreviewActions.open({
      id: event.file.id,
      file: event.file,
      label: event.file.displayName,
      caption: event.revisedPrompt || event.prompt,
      mimeType: event.file.mimeType,
    });
  };

  const prompt = event.revisedPrompt || event.prompt;

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-3 sm:flex-row sm:items-start">
      <div className="flex w-full shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-hover sm:w-64">
        {previewUrl ? (
          <button
            type="button"
            onClick={openLightbox}
            className="block h-full w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label={`预览图片：${event.file.displayName}`}
            title="点击查看大图"
          >
            <img
              className="h-full w-full object-contain"
              src={previewUrl}
              alt={event.revisedPrompt || event.prompt || event.file.displayName}
              loading="lazy"
              draggable={false}
            />
          </button>
        ) : (
          <div className="flex h-32 w-full items-center justify-center text-2xs text-foreground-muted">
            {loading ? '图片加载中...' : error ? '图片预览失败' : '图片暂不可预览'}
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-2xs uppercase tracking-wide text-foreground-muted">
              {event.operation === 'edit' ? '图片编辑' : '图片生成'}
            </div>
            <div className="truncate text-sm font-medium">{event.file.displayName}</div>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
            <button
              type="button"
              onClick={() => onDownload?.(event.file)}
              disabled={downloading}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground hover:bg-surface-hover disabled:opacity-50"
            >
              <Download className="h-3 w-3" />
              下载
            </button>
            <button
              type="button"
              onClick={() => onReuseImage?.(event.file)}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground hover:bg-surface-hover"
            >
              <ImagePlus className="h-3 w-3" />
              继续编辑
            </button>
          </div>
        </div>
        <details className="group/image rounded-md border border-border bg-surface">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-2.5 py-1.5 text-2xs text-foreground-muted hover:bg-surface-hover">
            <span>图片信息</span>
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-open/image:rotate-180" />
          </summary>
          <div className="flex flex-col gap-2 border-t border-border px-2.5 py-2 text-xs">
            <div className="flex flex-wrap gap-1.5 text-2xs text-foreground-muted">
              <span className="rounded-full bg-background px-2 py-0.5">{event.model}</span>
              <span className="rounded-full bg-background px-2 py-0.5">
                {event.file.mimeType ?? 'image/png'}
              </span>
              <span className="rounded-full bg-background px-2 py-0.5">
                {formatBytes(event.file.size)}
              </span>
            </div>
            <div className="rounded-md border border-border bg-surface px-2 py-1.5">
              <strong className="mr-1 text-foreground-muted">提示词</strong>
              <span className="text-foreground">{prompt}</span>
            </div>
          </div>
        </details>
      </div>
    </article>
  );
};

/* ----------------------------- markdown chrome ----------------------------- */

const collectText = (node: ReactNode): string => {
  if (node == null || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectText).join('');
  if (isValidElement(node)) {
    const props = node.props as { children?: ReactNode } | undefined;
    return collectText(props?.children);
  }
  return '';
};

const LANG_LABEL: Record<string, string> = {
  js: 'JavaScript',
  jsx: 'JSX',
  ts: 'TypeScript',
  tsx: 'TSX',
  py: 'Python',
  rb: 'Ruby',
  sh: 'Shell',
  bash: 'Bash',
  zsh: 'Zsh',
  md: 'Markdown',
  yml: 'YAML',
  yaml: 'YAML',
  json: 'JSON',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  go: 'Go',
  rs: 'Rust',
  java: 'Java',
  kt: 'Kotlin',
  swift: 'Swift',
  php: 'PHP',
  sql: 'SQL',
  c: 'C',
  cpp: 'C++',
  cs: 'C#',
  text: 'Text',
  txt: 'Text',
};

const formatLanguage = (lang: string) => {
  if (!lang) return '';
  const lower = lang.toLowerCase();
  return LANG_LABEL[lower] ?? lang;
};

const InlineCopyButton = ({ getText, label = '复制' }: { getText: () => string; label?: string }) => {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const t = window.setTimeout(() => setState('idle'), 1400);
    return () => window.clearTimeout(t);
  }, [state]);

  return (
    <button
      type="button"
      onClick={async (event) => {
        event.preventDefault();
        event.stopPropagation();
        try {
          if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
          await navigator.clipboard.writeText(getText());
          setState('copied');
        } catch {
          setState('failed');
        }
      }}
      className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-2xs text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground"
      aria-label={label}
      title={label}
    >
      {state === 'copied' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      <span>{state === 'copied' ? '已复制' : state === 'failed' ? '复制失败' : label}</span>
    </button>
  );
};

const MarkdownCodeBlock = ({
  language,
  children,
  rawText,
}: {
  language: string;
  children: ReactNode;
  rawText: string;
}) => {
  const displayLang = formatLanguage(language);
  return (
    <div className="md-codeblock overflow-hidden rounded-[10px] border border-border bg-surface-hover">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface px-3 py-1">
        <span className="text-2xs font-medium uppercase tracking-wide text-foreground-muted">
          {displayLang || 'Code'}
        </span>
        <InlineCopyButton getText={() => rawText} label="复制代码" />
      </div>
      <pre className="!m-0 !rounded-none !border-0">
        {children}
      </pre>
    </div>
  );
};

const isExternalHref = (href?: string) =>
  typeof href === 'string' && /^https?:\/\//i.test(href);

const markdownComponents: Components = {
  // Wrap tables in a scroll container with rounded border so wide tables
  // don't break the bubble layout on mobile.
  table: ({ node: _node, ...props }) => (
    <div className="md-table-scroll my-2.5 overflow-x-auto rounded-[10px] border border-border">
      <table {...props} />
    </div>
  ),

  // Render block code with header + copy button. We hook into `pre` (not `code`)
  // because that is the reliable signal for "code block, not inline".
  pre: ({ node: _node, children }) => {
    const codeEl = Children.toArray(children).find(isValidElement);
    let language = '';
    let rawText = '';

    if (codeEl) {
      const codeProps = codeEl.props as { className?: string; children?: ReactNode };
      const match = /language-([\w-]+)/.exec(codeProps.className ?? '');
      language = match ? match[1] : '';
      rawText = collectText(codeProps.children).replace(/\n$/, '');
    } else {
      rawText = collectText(children);
    }

    return (
      <MarkdownCodeBlock language={language} rawText={rawText}>
        {children}
      </MarkdownCodeBlock>
    );
  },

  // External links: open in a new tab with a subtle indicator icon
  a: ({ node: _node, href, children, ...rest }) => {
    const external = isExternalHref(href);
    return (
      <a
        href={href}
        {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}
        {...rest}
      >
        {children}
        {external ? (
          <ExternalLink className="ml-0.5 inline h-[0.85em] w-[0.85em] -translate-y-[1px] opacity-70" />
        ) : null}
      </a>
    );
  },
};

const CopyableMessageBlock = ({
  variant,
  content,
  markdown,
  assistantMeta,
  attachments,
  onDownloadAttachment,
}: {
  variant: 'assistant' | 'user' | 'pending';
  content: string;
  markdown: string;
  assistantMeta?: AssistantMessageMeta;
  attachments?: FileRecord[];
  onDownloadAttachment?: (file: FileRecord) => void;
}) => {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (copyState === 'idle') {
      return;
    }
    const timer = window.setTimeout(() => setCopyState('idle'), 1600);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const handleCopy = async () => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error('clipboard unavailable');
      }
      await navigator.clipboard.writeText(content);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  const buttonLabel = copyState === 'copied' ? '已复制' : copyState === 'failed' ? '复制失败' : '复制';
  const isUser = variant === 'user';

  return (
    <div className={cn('group/msg relative flex w-full', isUser && 'justify-end')}>
      <div
        className={cn(
          'flex max-w-full flex-col',
          isUser ? 'items-end' : 'items-stretch',
          isUser ? 'max-w-[80%]' : 'w-full',
        )}
      >
        <div
          className={cn(
            isUser
              ? 'prose prose-chat max-w-none rounded-2xl bg-surface-hover px-4 py-2.5 text-foreground'
              : 'prose prose-chat text-foreground',
          )}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {markdown}
          </ReactMarkdown>
        </div>
        {attachments && attachments.length > 0 ? (
          <MessageAttachments
            attachments={attachments}
            align={isUser ? 'end' : 'start'}
            onDownload={onDownloadAttachment}
          />
        ) : null}
        {!isUser ? <AssistantMetaFooter meta={assistantMeta} /> : null}
        <button
          type="button"
          onClick={() => {
            void handleCopy();
          }}
          aria-label="复制消息内容"
          title="复制消息内容"
          className={cn(
            'mt-1 inline-flex h-6 items-center gap-1 self-start rounded-md px-1.5 text-2xs text-foreground-muted opacity-0 transition-opacity hover:bg-surface-hover hover:text-foreground group-hover/msg:opacity-100 focus-visible:opacity-100',
            isUser && 'self-end',
          )}
        >
          {copyState === 'copied' ? (
            <Check className="h-3 w-3" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
          {buttonLabel}
        </button>
      </div>
    </div>
  );
};

const ThinkingBubble = ({ createdAt, content }: { createdAt: string; content: string }) => {
  const [elapsedSeconds, setElapsedSeconds] = useState(() => getElapsedSeconds(createdAt));
  const elapsedLabel = formatElapsedDuration(elapsedSeconds);
  const label = getThinkingBubbleLabel(content);

  useEffect(() => {
    setElapsedSeconds(getElapsedSeconds(createdAt));
    const timer = window.setInterval(() => {
      setElapsedSeconds(getElapsedSeconds(createdAt));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [createdAt]);

  return (
    <div className="flex">
      <div
        title={content}
        aria-label={`${label}，已持续 ${elapsedLabel}`}
        className="inline-flex items-center gap-1.5 rounded-full bg-surface-hover px-3 py-1 text-xs text-foreground-muted"
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        {`${label}(${elapsedLabel})`}
      </div>
    </div>
  );
};

const hasToolTraceDetails = (event: ToolTraceDisplayEvent) =>
  Boolean(
    (event.arguments && Object.keys(event.arguments).length > 0) ||
      event.resultContent ||
      (typeof event.percent === 'number' && event.status === 'running'),
  );

const getToolIcon = (tool: string) => {
  if (tool === 'web_search') {
    return Search;
  }
  if (tool === 'web_fetch') {
    return Globe;
  }
  if (tool === 'read_file' || tool === 'read_workspace_path_slice') {
    return FileText;
  }
  if (tool === 'list_files' || tool === 'list_workspace_paths') {
    return FolderOpen;
  }
  if (tool === 'run_workspace_script') {
    return Terminal;
  }
  if (tool === 'write_artifact_file') {
    return Download;
  }
  return Wrench;
};

const ToolStatusBadge = ({ status }: { status: ToolTraceDisplayEvent['status'] }) => {
  if (status === 'success') {
    return null;
  }

  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-1.5 py-0.5 text-[0.68rem] leading-none',
        toolStatusToneClass[status],
      )}
    >
      {toolStatusLabel[status]}
    </span>
  );
};

const ToolTraceIcon = ({ tool }: { tool: string }) => {
  const Icon = getToolIcon(tool);
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-hover text-foreground-muted">
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
    </span>
  );
};

const ToolTraceDetails = ({ event }: { event: ToolTraceDisplayEvent }) => {
  const displayArguments = formatToolArguments(event.tool, event.arguments);

  return (
    <div className="flex flex-col gap-1.5 border-t border-border px-2.5 py-1.5 text-2xs">
      {event.arguments && Object.keys(event.arguments).length > 0 ? (
        <div className="flex flex-col gap-1">
          <div className="text-2xs uppercase tracking-wide text-foreground-muted">参数</div>
          <pre className="overflow-x-auto rounded-md bg-surface-hover px-2 py-1 text-2xs text-foreground">
            {displayArguments}
          </pre>
        </div>
      ) : null}
      {event.resultContent ? (
        <div className="flex flex-col gap-1">
          <div className="text-2xs uppercase tracking-wide text-foreground-muted">返回结果</div>
          <pre className="max-h-72 overflow-auto rounded-md bg-surface-hover px-2 py-1 text-2xs text-foreground whitespace-pre-wrap">
            {event.resultContent}
          </pre>
        </div>
      ) : null}
      {typeof event.percent === 'number' && event.status === 'running' ? (
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-hover">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${Math.max(0, Math.min(100, event.percent))}%` }}
          />
        </div>
      ) : null}
    </div>
  );
};

const ToolTraceSummary = ({ event }: { event: ToolTraceDisplayEvent }) => {
  const displayTool = formatToolName(event.tool, event.arguments);
  const displayMessage = formatToolWorkDescription(event);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <ToolTraceIcon tool={event.tool} />
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <strong className="shrink-0 text-xs font-medium">{displayTool}</strong>
        <span className="truncate text-[0.72rem] leading-4 text-foreground-muted">
          {displayMessage}
        </span>
      </div>
      <ToolStatusBadge status={event.status} />
    </div>
  );
};

const ToolTraceCardView = ({
  event,
  canExpandToolTrace,
}: {
  event: ToolTraceDisplayEvent;
  canExpandToolTrace: boolean;
}) => {
  const hasDetails = hasToolTraceDetails(event);

  if (!canExpandToolTrace || !hasDetails) {
    return (
      <article className="rounded-md border border-l-2 border-border border-l-accent/80 bg-surface px-2.5 py-1.5">
        <ToolTraceSummary event={event} />
      </article>
    );
  }

  return (
    <article className="rounded-md border border-l-2 border-border border-l-accent/80 bg-surface">
      <details className="group/trace">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 hover:bg-surface-hover">
          <ToolTraceSummary event={event} />
          <ChevronDown className="h-3.5 w-3.5 text-foreground-muted transition-transform group-open/trace:rotate-180" />
        </summary>
        <ToolTraceDetails event={event} />
      </details>
    </article>
  );
};

const ToolTraceGroupItemView = ({
  event,
  index,
}: {
  event: ToolTraceDisplayEvent;
  index: number;
}) => {
  const hasDetails = hasToolTraceDetails(event);
  const counter = `#${index + 1}`;

  if (!hasDetails) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-2">
        <span className="w-6 shrink-0 text-right text-2xs tabular-nums text-foreground-muted">
          {counter}
        </span>
        <ToolTraceSummary event={event} />
      </div>
    );
  }

  return (
    <details className="group/trace-item">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-2 hover:bg-surface-hover">
        <span className="w-6 shrink-0 text-right text-2xs tabular-nums text-foreground-muted">
          {counter}
        </span>
        <ToolTraceSummary event={event} />
        <ChevronDown className="h-3.5 w-3.5 text-foreground-muted transition-transform group-open/trace-item:rotate-180" />
      </summary>
      <div className="pl-10">
        <ToolTraceDetails event={event} />
      </div>
    </details>
  );
};

const ToolTraceGroupCardView = ({
  event,
  canExpandToolTrace,
}: {
  event: ToolTraceGroupDisplayEvent;
  canExpandToolTrace: boolean;
}) => {
  const countSummary = formatToolGroupCounts(event.items);
  const summary = (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-hover text-foreground-muted">
        <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-1 items-baseline gap-2">
        <strong className="shrink-0 text-xs font-medium">使用 {event.items.length} 次工具</strong>
        <span className="truncate text-[0.72rem] leading-4 text-foreground-muted">
          {countSummary}
        </span>
      </div>
      <ToolStatusBadge status={event.status} />
    </div>
  );

  if (!canExpandToolTrace) {
    return (
      <article className="rounded-md border border-l-2 border-border border-l-accent/80 bg-surface px-2.5 py-1.5">
        {summary}
      </article>
    );
  }

  return (
    <article className="rounded-md border border-l-2 border-border border-l-accent/80 bg-surface">
      <details className="group/trace-group">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 hover:bg-surface-hover">
          {summary}
          <ChevronDown className="h-3.5 w-3.5 text-foreground-muted transition-transform group-open/trace-group:rotate-180" />
        </summary>
        <div className="divide-y divide-border border-t border-border bg-background">
          {event.items.map((item, index) => (
            <ToolTraceGroupItemView key={item.id} event={item} index={index} />
          ))}
        </div>
      </details>
    </article>
  );
};

export const MessageItem = ({
  event,
  assistantMeta,
  onDownload,
  onReuseImage,
  downloading = false,
  canExpandToolTrace = true,
}: Props) => {
  if (event.kind === 'pending_text') {
    return (
      <article className="flex w-full">
        <CopyableMessageBlock
          variant="pending"
          content={event.content}
          markdown={event.content}
          assistantMeta={assistantMeta}
        />
      </article>
    );
  }

  if (event.kind === 'message') {
    return (
      <article className={cn('flex w-full', event.role === 'user' && 'justify-end')}>
        <CopyableMessageBlock
          variant={event.role === 'user' ? 'user' : 'assistant'}
          content={event.content}
          markdown={event.content}
          assistantMeta={event.role === 'assistant' ? event.meta : undefined}
          attachments={event.attachments}
          onDownloadAttachment={onDownload}
        />
      </article>
    );
  }

  if (event.kind === 'thinking') {
    return <ThinkingBubble createdAt={event.createdAt} content={event.content} />;
  }

  if (event.kind === 'tool_trace') {
    return <ToolTraceCardView event={event} canExpandToolTrace={canExpandToolTrace} />;
  }

  if (event.kind === 'tool_trace_group') {
    return <ToolTraceGroupCardView event={event} canExpandToolTrace={canExpandToolTrace} />;
  }

  if (event.kind === 'tool_call') {
    return (
      <article className="rounded-md border border-border bg-surface p-3 text-xs">
        <div className="text-2xs uppercase tracking-wide text-foreground-muted">工具调用</div>
        <strong className="block mt-0.5 text-sm">{event.skill}</strong>
        <pre className="mt-2 overflow-x-auto rounded-md bg-surface-hover px-2 py-1.5 text-2xs">
          {JSON.stringify(event.arguments, null, 2)}
        </pre>
      </article>
    );
  }

  if (event.kind === 'tool_progress') {
    return (
      <article className="rounded-md border border-l-[3px] border-border border-l-accent bg-surface p-3 text-xs">
        <div className="text-2xs uppercase tracking-wide text-foreground-muted">工具进度</div>
        <strong className="block mt-0.5 text-sm">{event.skill}</strong>
        <div className="mt-0.5 text-foreground">{event.message}</div>
        {typeof event.percent === 'number' ? (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-hover">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${Math.max(0, Math.min(100, event.percent))}%` }}
            />
          </div>
        ) : null}
      </article>
    );
  }

  if (event.kind === 'tool_result') {
    return (
      <article className="rounded-md border border-border bg-surface p-3 text-xs">
        <div className="text-2xs uppercase tracking-wide text-foreground-muted">工具结果</div>
        <strong className="block mt-0.5 text-sm">{event.skill}</strong>
        <div className="mt-0.5 text-foreground">{event.message}</div>
      </article>
    );
  }

  if (event.kind === 'file') {
    return (
      <article className="flex items-start justify-between gap-2 rounded-md border border-border bg-surface px-3 py-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="truncate text-sm font-medium">{event.file.displayName}</div>
          <div className="text-2xs text-foreground-muted">
            {event.file.mimeType ?? 'application/octet-stream'} · {formatBytes(event.file.size)}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onDownload?.(event.file)}
          disabled={downloading}
          className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-xs text-foreground hover:bg-surface-hover disabled:opacity-50"
        >
          <Download className="h-3 w-3" />
          下载
        </button>
      </article>
    );
  }

  if (event.kind === 'image') {
    return (
      <ImageEventCard
        event={event}
        onDownload={onDownload}
        onReuseImage={onReuseImage}
        downloading={downloading}
      />
    );
  }

  return (
    <article className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 p-3 text-sm text-danger">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex flex-col gap-0.5">
        <div className="text-2xs uppercase tracking-wide">错误</div>
        <div>{event.message}</div>
      </div>
    </article>
  );
};
