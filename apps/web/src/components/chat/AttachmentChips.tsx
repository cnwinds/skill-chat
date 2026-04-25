import { X } from 'lucide-react';
import type { ComposerAttachment } from '@/hooks/useComposerAttachments';
import { formatBytes } from '@/lib/utils';
import { cn } from '@/lib/cn';

export interface AttachmentChipsProps {
  attachments: ComposerAttachment[];
  onRemove?: (localId: string) => void;
}

export const AttachmentChips = ({ attachments, onRemove }: AttachmentChipsProps) => {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div
      className="flex flex-wrap gap-1.5 overflow-x-auto pb-1.5"
      aria-live="polite"
    >
      {attachments.map((attachment) => {
        const isUploading = attachment.status === 'uploading';
        return (
          <div
            key={attachment.localId}
            className={cn(
              'flex items-center gap-1.5 rounded-md border border-border bg-surface-hover px-2 py-1 text-2xs',
              isUploading && 'animate-pulse',
            )}
          >
            <span className="max-w-[10rem] truncate font-medium text-foreground">
              {attachment.displayName}
            </span>
            <span className="text-foreground-muted">
              {isUploading
                ? '上传中...'
                : `${attachment.mimeType?.startsWith('image/') ? '图片附件' : '已附加'} · ${formatBytes(attachment.size)}`}
            </span>
            {onRemove ? (
              <button
                type="button"
                onClick={() => onRemove(attachment.localId)}
                className="rounded p-0.5 text-foreground-muted hover:bg-surface hover:text-foreground"
                aria-label={`移除附件：${attachment.displayName}`}
                title="移除附件"
              >
                <X className="h-3 w-3" />
              </button>
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

export default AttachmentChips;
