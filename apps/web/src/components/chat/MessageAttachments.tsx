import { Download, FileIcon } from 'lucide-react';
import type { FileRecord } from '@skillchat/shared';
import { useFilePreviewUrl } from '@/hooks/useFilePreviewUrl';
import { imagePreviewActions } from '@/hooks/useImagePreview';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/utils';

interface MessageAttachmentsProps {
  attachments: FileRecord[];
  align?: 'start' | 'end';
  onDownload?: (file: FileRecord) => void;
}

interface ImageAttachmentThumbProps {
  file: FileRecord;
}

const ImageAttachmentThumb = ({ file }: ImageAttachmentThumbProps) => {
  const { previewUrl, loading, error } = useFilePreviewUrl(file, true);

  const handleClick = () => {
    imagePreviewActions.open({
      id: file.id,
      file,
      label: file.displayName,
      mimeType: file.mimeType,
    });
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className={cn(
        'group/thumb relative flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-hover transition-colors',
        'hover:border-accent focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent',
      )}
      aria-label={`预览图片：${file.displayName}`}
      title={file.displayName}
    >
      {previewUrl ? (
        <img
          src={previewUrl}
          alt={file.displayName}
          loading="lazy"
          draggable={false}
          className="h-full w-full object-cover transition-transform group-hover/thumb:scale-[1.02]"
        />
      ) : (
        <span className="px-1 text-center text-2xs text-foreground-muted">
          {loading ? '图片加载中...' : error ? '预览失败' : '点击预览'}
        </span>
      )}
    </button>
  );
};

interface FileAttachmentRowProps {
  file: FileRecord;
  onDownload?: (file: FileRecord) => void;
}

const FileAttachmentRow = ({ file, onDownload }: FileAttachmentRowProps) => (
  <article className="flex items-center gap-2 rounded-md border border-border bg-surface px-2.5 py-1.5">
    <FileIcon className="h-4 w-4 shrink-0 text-foreground-muted" />
    <div className="flex min-w-0 flex-1 flex-col">
      <span className="truncate text-xs font-medium" title={file.displayName}>
        {file.displayName}
      </span>
      <span className="text-2xs text-foreground-muted">
        {file.mimeType ?? 'application/octet-stream'} · {formatBytes(file.size)}
      </span>
    </div>
    {onDownload ? (
      <button
        type="button"
        onClick={() => onDownload(file)}
        className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-2xs text-foreground hover:bg-surface-hover"
        aria-label={`下载附件：${file.displayName}`}
      >
        <Download className="h-3 w-3" />
        下载
      </button>
    ) : null}
  </article>
);

export const MessageAttachments = ({
  attachments,
  align = 'start',
  onDownload,
}: MessageAttachmentsProps) => {
  if (!attachments || attachments.length === 0) {
    return null;
  }

  const images = attachments.filter((file) => file.mimeType?.startsWith('image/'));
  const others = attachments.filter((file) => !file.mimeType?.startsWith('image/'));

  return (
    <div
      className={cn(
        'mt-2 flex flex-col gap-2',
        align === 'end' ? 'items-end' : 'items-start',
      )}
    >
      {images.length > 0 ? (
        <div
          className={cn(
            'flex flex-wrap gap-2',
            align === 'end' && 'justify-end',
          )}
        >
          {images.map((file) => (
            <ImageAttachmentThumb key={file.id} file={file} />
          ))}
        </div>
      ) : null}
      {others.length > 0 ? (
        <div className="flex w-full max-w-md flex-col gap-1.5">
          {others.map((file) => (
            <FileAttachmentRow key={file.id} file={file} onDownload={onDownload} />
          ))}
        </div>
      ) : null}
    </div>
  );
};

export default MessageAttachments;
