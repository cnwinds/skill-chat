import { create } from 'zustand';
import type { FileRecord } from '@skillchat/shared';

export interface ImagePreviewTarget {
  /** Stable identifier of this preview (FileRecord.id, or a synthetic id for transient blobs). */
  id: string;
  /** Optional FileRecord, when the preview originates from a stored file. */
  file?: FileRecord;
  /** Optional pre-resolved object URL / data URL, used when the source already has a blob. */
  src?: string;
  /** Display label shown above the image (e.g. file name). */
  label?: string;
  /** Free-form caption shown under the image (e.g. revised prompt). */
  caption?: string;
  /** Optional MIME type to gate fallback behavior. */
  mimeType?: string | null;
}

interface ImagePreviewState {
  target: ImagePreviewTarget | null;
  open: (target: ImagePreviewTarget) => void;
  close: () => void;
}

const useImagePreviewStore = create<ImagePreviewState>((set) => ({
  target: null,
  open: (target) => set({ target }),
  close: () => set({ target: null }),
}));

export const useImagePreview = () => useImagePreviewStore((state) => state.target);
export const useImagePreviewActions = () => ({
  open: useImagePreviewStore((state) => state.open),
  close: useImagePreviewStore((state) => state.close),
});

export const imagePreviewActions = {
  open: (target: ImagePreviewTarget) => useImagePreviewStore.getState().open(target),
  close: () => useImagePreviewStore.getState().close(),
};
