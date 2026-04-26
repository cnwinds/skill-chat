import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ImageLightbox } from './ImageLightbox';
import { imagePreviewActions } from '@/hooks/useImagePreview';

const createRect = (width: number, height: number, left = 0, top = 0): DOMRect => ({
  x: left,
  y: top,
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
  toJSON: () => ({}),
} as DOMRect);

describe('ImageLightbox', () => {
  afterEach(() => {
    imagePreviewActions.close();
    cleanup();
  });

  it('supports pinch zoom gestures for mobile image inspection', () => {
    imagePreviewActions.open({
      id: 'preview-1',
      src: 'blob:preview-image',
      label: '预览图',
      mimeType: 'image/png',
    });

    render(<ImageLightbox />);

    const stage = screen.getByTestId('image-lightbox-stage');
    const frame = screen.getByTestId('image-lightbox-frame');
    const image = screen.getByRole('img', { name: '预览图' });

    stage.setPointerCapture = () => undefined;
    stage.releasePointerCapture = () => undefined;
    stage.getBoundingClientRect = () => createRect(320, 320, 0, 0);
    frame.getBoundingClientRect = () => createRect(240, 180, 40, 70);

    fireEvent.pointerDown(stage, {
      pointerId: 1,
      clientX: 110,
      clientY: 150,
      pointerType: 'touch',
    });
    fireEvent.pointerDown(stage, {
      pointerId: 2,
      clientX: 210,
      clientY: 150,
      pointerType: 'touch',
    });
    fireEvent.pointerMove(stage, {
      pointerId: 2,
      clientX: 290,
      clientY: 150,
      pointerType: 'touch',
    });

    expect(image.getAttribute('style')).toContain('scale(1.8)');
  });
});
