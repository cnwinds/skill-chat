import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

/**
 * Keeps a scrollable container pinned to its bottom whenever any of the
 * supplied dependencies change, but only while the user hasn't scrolled
 * up themselves. The threshold is in pixels from the bottom.
 */
export const useAutoScrollToBottom = <T extends HTMLElement>(
  deps: ReadonlyArray<unknown>,
  thresholdPx = 64,
): RefObject<T | null> => {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const target = ref.current;
    if (!target) {
      return;
    }
    const distanceFromBottom = target.scrollHeight - (target.scrollTop + target.clientHeight);
    if (distanceFromBottom <= thresholdPx) {
      target.scrollTop = target.scrollHeight;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return ref;
};
