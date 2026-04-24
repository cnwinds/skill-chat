import { useEffect, useState } from 'react';
import type { FileRecord } from '@skillchat/shared';
import { api } from '../lib/api';

export const useFilePreviewUrl = (file: FileRecord | null, enabled = true) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !file) {
      setPreviewUrl(null);
      setLoading(false);
      setError(null);
      return;
    }

    let revokedUrl: string | null = null;
    let disposed = false;

    setLoading(true);
    setError(null);

    void api.fetchFileBlob(file.id)
      .then((blob) => {
        if (disposed) {
          return;
        }
        revokedUrl = URL.createObjectURL(blob);
        setPreviewUrl(revokedUrl);
      })
      .catch((fetchError) => {
        if (disposed) {
          return;
        }
        setError(fetchError instanceof Error ? fetchError.message : '图片预览失败');
      })
      .finally(() => {
        if (!disposed) {
          setLoading(false);
        }
      });

    return () => {
      disposed = true;
      if (revokedUrl) {
        URL.revokeObjectURL(revokedUrl);
      }
    };
  }, [enabled, file]);

  return {
    previewUrl,
    loading,
    error,
  };
};
