import { useEffect, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Download, X } from 'lucide-react';
import { useImagePreview, useImagePreviewActions } from '@/hooks/useImagePreview';
import { useFilePreviewUrl } from '@/hooks/useFilePreviewUrl';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatBytes } from '@/lib/utils';

/**
 * Resolves the image URL for the current preview target. Prefers an explicitly
 * provided `src`, otherwise loads the file blob via the existing preview hook.
 */
const useResolvedPreviewUrl = (target: ReturnType<typeof useImagePreview>) => {
  const file = target?.file ?? null;
  const isImage = file?.mimeType?.startsWith('image/') === true;
  const { previewUrl, loading, error } = useFilePreviewUrl(
    target?.src ? null : file,
    Boolean(target) && !target?.src && isImage,
    'original',
  );

  if (target?.src) {
    return { url: target.src, loading: false, error: null as string | null };
  }
  return { url: previewUrl, loading, error };
};

export const ImageLightbox = () => {
  const target = useImagePreview();
  const { close } = useImagePreviewActions();
  const { url, loading, error } = useResolvedPreviewUrl(target);
  const [downloading, setDownloading] = useState(false);

  // Reset transient state when the target changes.
  useEffect(() => {
    setDownloading(false);
  }, [target?.id]);

  const handleDownload = async () => {
    if (!target?.file) {
      return;
    }
    try {
      setDownloading(true);
      await api.downloadFile(target.file);
    } finally {
      setDownloading(false);
    }
  };

  const open = Boolean(target);

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          close();
        }
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-[60] bg-black/80 data-[state=open]:animate-fade-in',
          )}
        />
        <DialogPrimitive.Content
          className={cn(
            'fixed inset-0 z-[60] flex h-full w-full flex-col items-center justify-center px-4 py-6 outline-none',
          )}
        >
          <DialogPrimitive.Title className="sr-only">
            {target?.label ?? '图片预览'}
          </DialogPrimitive.Title>
          {target?.caption ? (
            <DialogPrimitive.Description className="sr-only">
              {target.caption}
            </DialogPrimitive.Description>
          ) : null}

          {/* Top toolbar */}
          <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
            {target?.file ? (
              <button
                type="button"
                onClick={() => {
                  void handleDownload();
                }}
                disabled={downloading}
                className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2.5 py-1.5 text-xs text-white backdrop-blur transition-colors hover:bg-white/20 disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" />
                下载
              </button>
            ) : null}
            <DialogPrimitive.Close
              className="inline-flex items-center justify-center rounded-md bg-white/10 p-1.5 text-white backdrop-blur transition-colors hover:bg-white/20"
              aria-label="关闭预览"
            >
              <X className="h-4 w-4" />
            </DialogPrimitive.Close>
          </div>

          {/* Image */}
          <div
            className="flex max-h-full max-w-full flex-1 items-center justify-center"
            onClick={(event) => {
              // Click on the empty area closes the lightbox.
              if (event.target === event.currentTarget) {
                close();
              }
            }}
          >
            {url ? (
              <img
                src={url}
                alt={target?.label ?? '图片预览'}
                className="max-h-[85vh] max-w-[90vw] select-none object-contain shadow-2xl"
                draggable={false}
              />
            ) : loading ? (
              <div className="text-sm text-white/80">图片加载中...</div>
            ) : error ? (
              <div className="text-sm text-white/80">图片预览失败：{error}</div>
            ) : (
              <div className="text-sm text-white/80">暂无图片</div>
            )}
          </div>

          {/* Footer caption */}
          {target?.label || target?.caption ? (
            <div className="z-10 mt-3 max-w-[90vw] rounded-md bg-black/40 px-4 py-2 text-center text-white backdrop-blur">
              {target?.label ? (
                <div className="truncate text-sm font-medium">
                  {target.label}
                  {target.file?.size ? (
                    <span className="ml-2 text-xs text-white/70">
                      {target.file.mimeType ?? 'image/*'} · {formatBytes(target.file.size)}
                    </span>
                  ) : null}
                </div>
              ) : null}
              {target?.caption ? (
                <div className="mt-0.5 line-clamp-3 text-xs text-white/80">
                  {target.caption}
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

export default ImageLightbox;
