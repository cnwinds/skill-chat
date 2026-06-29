import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vitest/config';

const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url));
const harnessKitDist = path.join(workspaceRoot, 'node_modules/@skillchat/harness-react/dist');
const harnessKitStreamStore = path.join(harnessKitDist, 'store/stream-ui-store.js');
const harnessKitReactEntry = path.join(harnessKitDist, 'index.js');
const lucideReact = path.join(workspaceRoot, 'node_modules/lucide-react');

const forceSharedRuntime = (): Plugin => ({
  name: 'force-shared-runtime',
  enforce: 'pre',
  resolveId(source) {
    // Keep one stream-ui-store module instance across app + @skillchat/harness-react.
    if (source.includes('stream-ui-store')) {
      return harnessKitStreamStore;
    }
    if (source === 'lucide-react') {
      return path.join(lucideReact, 'dist/esm/lucide-react.mjs');
    }
    return null;
  },
});

export default defineConfig({
  plugins: [forceSharedRuntime(), react()],
  resolve: {
    dedupe: ['react', 'react-dom', 'zustand', '@tanstack/react-query', 'lucide-react', '@skillchat/harness-react'],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@skillchat/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
      '@skillchat/harness-react': harnessKitReactEntry,
      'lucide-react': path.join(lucideReact, 'dist/esm/lucide-react.mjs'),
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  optimizeDeps: {
    include: ['@skillchat/harness-react', 'zustand', 'zustand/vanilla', 'zustand/react'],
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    pool: 'forks',
    maxWorkers: 1,
    server: {
      deps: {
        inline: ['@skillchat/harness-react'],
      },
    },
  },
});
