import { useEffect, useRef, useState } from 'react';
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

const MIN_SCALE = 1;
const MAX_SCALE = 5;

type Point = {
  x: number;
  y: number;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const getDistance = (first: Point, second: Point) =>
  Math.hypot(second.x - first.x, second.y - first.y);

const getMidpoint = (first: Point, second: Point): Point => ({
  x: (first.x + second.x) / 2,
  y: (first.y + second.y) / 2,
});

export const ImageLightbox = () => {
  const target = useImagePreview();
  const { close } = useImagePreviewActions();
  const { url, loading, error } = useResolvedPreviewUrl(target);
  const [downloading, setDownloading] = useState(false);
  const [scale, setScale] = useState(MIN_SCALE);
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const stageRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const pointersRef = useRef(new Map<number, Point>());
  const transformRef = useRef({
    scale: MIN_SCALE,
    offset: { x: 0, y: 0 } as Point,
  });
  const pinchRef = useRef<{
    startDistance: number;
    startScale: number;
    startOffset: Point;
    startMidpoint: Point;
    stageCenter: Point;
  } | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startPoint: Point;
    startOffset: Point;
  } | null>(null);

  // Reset transient state when the target changes.
  useEffect(() => {
    setDownloading(false);
    setScale(MIN_SCALE);
    setOffset({ x: 0, y: 0 });
    transformRef.current = {
      scale: MIN_SCALE,
      offset: { x: 0, y: 0 },
    };
    pointersRef.current.clear();
    pinchRef.current = null;
    dragRef.current = null;
  }, [target?.id]);

  const clampOffset = (nextScale: number, nextOffset: Point): Point => {
    if (nextScale <= MIN_SCALE) {
      return { x: 0, y: 0 };
    }

    const stageRect = stageRef.current?.getBoundingClientRect();
    const frameRect = frameRef.current?.getBoundingClientRect();
    if (!stageRect || !frameRect) {
      return nextOffset;
    }

    const maxX = Math.max(0, (frameRect.width * nextScale - stageRect.width) / 2);
    const maxY = Math.max(0, (frameRect.height * nextScale - stageRect.height) / 2);

    return {
      x: clamp(nextOffset.x, -maxX, maxX),
      y: clamp(nextOffset.y, -maxY, maxY),
    };
  };

  const applyTransform = (nextScale: number, nextOffset: Point) => {
    const clampedScale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
    const clampedOffset = clampOffset(clampedScale, nextOffset);
    transformRef.current = {
      scale: clampedScale,
      offset: clampedOffset,
    };
    setScale(clampedScale);
    setOffset(clampedOffset);
  };

  const beginPinchGesture = () => {
    const stageRect = stageRef.current?.getBoundingClientRect();
    if (!stageRect || pointersRef.current.size < 2) {
      pinchRef.current = null;
      return;
    }

    const [first, second] = [...pointersRef.current.values()];
    pinchRef.current = {
      startDistance: getDistance(first, second),
      startScale: transformRef.current.scale,
      startOffset: transformRef.current.offset,
      startMidpoint: getMidpoint(first, second),
      stageCenter: {
        x: stageRect.left + stageRect.width / 2,
        y: stageRect.top + stageRect.height / 2,
      },
    };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!url) {
      return;
    }

    const point = { x: event.clientX, y: event.clientY };
    pointersRef.current.set(event.pointerId, point);
    event.currentTarget.setPointerCapture?.(event.pointerId);

    if (pointersRef.current.size >= 2) {
      dragRef.current = null;
      beginPinchGesture();
      return;
    }

    if (transformRef.current.scale > MIN_SCALE) {
      dragRef.current = {
        pointerId: event.pointerId,
        startPoint: point,
        startOffset: transformRef.current.offset,
      };
    }
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) {
      return;
    }

    const point = { x: event.clientX, y: event.clientY };
    pointersRef.current.set(event.pointerId, point);

    if (pointersRef.current.size >= 2) {
      if (!pinchRef.current) {
        beginPinchGesture();
      }
      const pinch = pinchRef.current;
      const [first, second] = [...pointersRef.current.values()];
      if (!pinch || !first || !second || pinch.startDistance <= 0) {
        return;
      }

      const currentDistance = getDistance(first, second);
      const nextScale = clamp(
        pinch.startScale * (currentDistance / pinch.startDistance),
        MIN_SCALE,
        MAX_SCALE,
      );
      const currentMidpoint = getMidpoint(first, second);
      const scaleRatio = nextScale / pinch.startScale;
      const nextOffset = {
        x:
          currentMidpoint.x -
          pinch.stageCenter.x -
          scaleRatio * (pinch.startMidpoint.x - pinch.stageCenter.x - pinch.startOffset.x),
        y:
          currentMidpoint.y -
          pinch.stageCenter.y -
          scaleRatio * (pinch.startMidpoint.y - pinch.stageCenter.y - pinch.startOffset.y),
      };
      applyTransform(nextScale, nextOffset);
      return;
    }

    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || transformRef.current.scale <= MIN_SCALE) {
      return;
    }

    const nextOffset = {
      x: drag.startOffset.x + (point.x - drag.startPoint.x),
      y: drag.startOffset.y + (point.y - drag.startPoint.y),
    };
    applyTransform(transformRef.current.scale, nextOffset);
  };

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    event.currentTarget.releasePointerCapture?.(event.pointerId);

    if (pointersRef.current.size >= 2) {
      beginPinchGesture();
      return;
    }

    pinchRef.current = null;

    if (pointersRef.current.size === 1 && transformRef.current.scale > MIN_SCALE) {
      const [remainingPointerId, remainingPoint] = [...pointersRef.current.entries()][0] ?? [];
      if (typeof remainingPointerId === 'number' && remainingPoint) {
        dragRef.current = {
          pointerId: remainingPointerId,
          startPoint: remainingPoint,
          startOffset: transformRef.current.offset,
        };
        return;
      }
    }

    dragRef.current = null;
  };

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
            ref={stageRef}
            data-testid="image-lightbox-stage"
            className="flex max-h-full max-w-full flex-1 items-center justify-center"
            onClick={(event) => {
              // Click on the empty area closes the lightbox.
              if (event.target === event.currentTarget) {
                close();
              }
            }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            onPointerLeave={handlePointerEnd}
            style={{ touchAction: url ? 'none' : 'auto' }}
          >
            {url ? (
              <div
                ref={frameRef}
                data-testid="image-lightbox-frame"
                style={{
                  transform: `translate3d(${offset.x}px, ${offset.y}px, 0)`,
                }}
              >
                <img
                  src={url}
                  alt={target?.label ?? '图片预览'}
                  className="max-h-[85vh] max-w-[90vw] select-none object-contain shadow-2xl"
                  draggable={false}
                  style={{
                    transform: `scale(${scale})`,
                    transformOrigin: 'center center',
                  }}
                />
              </div>
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
