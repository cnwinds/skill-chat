import type { ChangeEvent, ClipboardEvent, KeyboardEvent } from 'react';
import { forwardRef, useEffect, useRef } from 'react';
import { ArrowUp, Paperclip, Square } from 'lucide-react';
import type { ComposerAttachment } from '@/hooks/useComposerAttachments';
import { cn } from '@/lib/cn';
import { AttachmentChips } from './AttachmentChips';

export interface ComposerProps {
  value: string;
  onValueChange: (value: string) => void;
  onSend: () => void;
  onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  attachments: ComposerAttachment[];
  onRemoveAttachment?: (localId: string) => void;
  onSelectFiles: (files: File[]) => void;
  isTurnRunning?: boolean;
  onInterrupt?: () => void;
  interruptPending?: boolean;
  sendPending?: boolean;
  disabled?: boolean;
  hasUploadingAttachments?: boolean;
  placeholder?: string;
  bottomInsetPx?: number;
}

const TEXTAREA_MAX_HEIGHT_PX = 192; // ~12rem

export const Composer = forwardRef<HTMLTextAreaElement, ComposerProps>(
  (
    {
      value,
      onValueChange,
      onSend,
      onPaste,
      attachments,
      onRemoveAttachment,
      onSelectFiles,
      isTurnRunning = false,
      onInterrupt,
      interruptPending = false,
      sendPending = false,
      disabled = false,
      hasUploadingAttachments = false,
      placeholder,
      bottomInsetPx = 0,
    },
    forwardedRef,
  ) => {
    const innerRef = useRef<HTMLTextAreaElement | null>(null);
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    const setRefs = (node: HTMLTextAreaElement | null) => {
      innerRef.current = node;
      if (typeof forwardedRef === 'function') {
        forwardedRef(node);
      } else if (forwardedRef) {
        forwardedRef.current = node;
      }
    };

    // Auto-grow up to TEXTAREA_MAX_HEIGHT_PX based on scrollHeight.
    useEffect(() => {
      const node = innerRef.current;
      if (!node) {
        return;
      }
      node.style.height = 'auto';
      const next = Math.min(node.scrollHeight, TEXTAREA_MAX_HEIGHT_PX);
      node.style.height = `${next}px`;
    }, [value]);

    const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        event.key === 'Enter' &&
        !event.shiftKey &&
        typeof window !== 'undefined' &&
        window.innerWidth >= 900
      ) {
        event.preventDefault();
        onSend();
      }
    };

    const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      event.currentTarget.value = '';
      onSelectFiles(files);
    };

    const sendDisabled =
      disabled || !value.trim() || hasUploadingAttachments || sendPending || interruptPending;

    return (
      <footer
        className="composer bg-background px-4 pt-3"
        style={{
          paddingBottom: `calc(14px + env(safe-area-inset-bottom) + ${bottomInsetPx}px)`,
        }}
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          <div className="composer-shell rounded-2xl border border-border bg-surface px-3 py-2">
            <AttachmentChips attachments={attachments} onRemove={onRemoveAttachment} />
            <label className="sr-only" htmlFor="chat-composer-input">
              聊天输入框
            </label>
            <textarea
              id="chat-composer-input"
              ref={setRefs}
              value={value}
              onChange={(event) => onValueChange(event.target.value)}
              onPaste={onPaste}
              placeholder={placeholder ?? '给 SkillChat 发送消息'}
              rows={1}
              className="block w-full resize-none border-0 bg-transparent text-base text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-0"
              onKeyDown={handleKeyDown}
            />
            <div className="mt-1 flex items-center justify-between">
              <div className="text-2xs text-foreground-muted">
                {hasUploadingAttachments ? <span>附件上传中...</span> : null}
                {!hasUploadingAttachments && isTurnRunning ? <span>当前轮处理中</span> : null}
              </div>
              <div className="flex items-center gap-1">
                {isTurnRunning && onInterrupt ? (
                  <button
                    type="button"
                    aria-label={interruptPending ? '中断中...' : '中断当前 turn'}
                    title={interruptPending ? '中断中...' : '中断当前 turn'}
                    onClick={onInterrupt}
                    disabled={interruptPending}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-surface text-foreground-muted hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
                  >
                    <Square className="h-3.5 w-3.5 fill-current" />
                  </button>
                ) : null}
                <button
                  type="button"
                  aria-label={hasUploadingAttachments ? '附件上传中' : '上传附件'}
                  title={hasUploadingAttachments ? '附件上传中' : '上传附件'}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={disabled || hasUploadingAttachments}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-foreground-muted hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
                >
                  <Paperclip className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={onSend}
                  aria-label={sendPending ? '提交中...' : isTurnRunning ? '补充信息' : '发送'}
                  title={sendPending ? '提交中...' : isTurnRunning ? '补充信息' : '发送'}
                  disabled={sendDisabled}
                  className={cn(
                    'inline-flex h-8 w-8 items-center justify-center rounded-md text-accent-foreground transition-opacity disabled:opacity-50',
                    'bg-accent hover:brightness-110',
                  )}
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              hidden
              multiple
              onChange={handleFileChange}
            />
          </div>
        </div>
      </footer>
    );
  },
);
Composer.displayName = 'Composer';

export default Composer;
