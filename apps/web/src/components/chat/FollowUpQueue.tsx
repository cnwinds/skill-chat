import { X } from 'lucide-react';
import type { RuntimeInputPreview } from '@skillchat/shared';

export interface FollowUpQueueProps {
  queue: RuntimeInputPreview[];
  onCancel?: (inputId: string) => void;
  cancelDisabled?: boolean;
}

export const FollowUpQueue = ({ queue, onCancel, cancelDisabled = false }: FollowUpQueueProps) => {
  if (queue.length === 0) {
    return null;
  }

  return (
    <div className="runtime-preview-stack">
      <div className="rounded-md border border-border bg-surface px-3 py-2">
        <div className="text-2xs uppercase tracking-wide text-foreground-muted">
          待处理队列（按顺序处理）
        </div>
        <ol className="mt-1 flex flex-col gap-1 text-sm">
          {queue.map((input, index) => (
            <li
              key={`follow-up-input-${input.inputId}`}
              className="flex items-start gap-2"
            >
              <span className="text-2xs text-foreground-muted">{index + 1}</span>{' '}
              <span className="flex-1">{input.content}</span>
              {onCancel ? (
                <button
                  type="button"
                  onClick={() => onCancel(input.inputId)}
                  disabled={cancelDisabled}
                  aria-label={`取消待处理项：${input.content}`}
                  title="取消这条待处理输入"
                  className="rounded p-1 text-foreground-muted hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
};

export default FollowUpQueue;
