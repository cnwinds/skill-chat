import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement window.matchMedia. Default to desktop layout
// (>=1024px) so route tests that interact with the desktop-only sidebar
// and inspector see them mounted by useIsDesktop().
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: /min-width:\s*(\d+)px/.test(query)
        ? Number(query.match(/min-width:\s*(\d+)px/)?.[1] ?? '0') <= 1280
        : false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}
