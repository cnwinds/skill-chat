import { useEffect, useState } from 'react';

const subscribe = (query: string, listener: () => void) => {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return () => undefined;
  }
  const mql = window.matchMedia(query);
  const handler = () => listener();
  // Modern browsers use addEventListener; old Safari uses addListener.
  if (mql.addEventListener) {
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }
  // Legacy MediaQueryList API (older Safari) — types include both add/removeListener.
  mql.addListener(handler);
  return () => {
    mql.removeListener(handler);
  };
};

const evaluate = (query: string): boolean => {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return false;
  }
  return window.matchMedia(query).matches;
};

export const useMediaQuery = (query: string): boolean => {
  const [matches, setMatches] = useState(() => evaluate(query));

  useEffect(() => {
    const update = () => setMatches(evaluate(query));
    update();
    return subscribe(query, update);
  }, [query]);

  return matches;
};

export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)');
export const useIsTablet = () => useMediaQuery('(min-width: 640px)');
