import type { Config } from 'tailwindcss';
import typography from '@tailwindcss/typography';

const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  corePlugins: {
    // Preflight resets many browser defaults; the legacy index.css below
    // still ships its own resets. Re-enabled in Phase 6 after cleanup.
    preflight: false,
  },
  theme: {
    container: {
      center: true,
      padding: '1rem',
    },
    extend: {
      colors: {
        background: 'var(--skc-background)',
        surface: 'var(--skc-surface)',
        'surface-hover': 'var(--skc-surface-hover)',
        border: 'var(--skc-border)',
        'border-strong': 'var(--skc-border-strong)',
        foreground: 'var(--skc-text)',
        'foreground-muted': 'var(--skc-text-muted)',
        accent: {
          DEFAULT: 'var(--skc-accent)',
          foreground: 'var(--skc-accent-fg)',
        },
        danger: {
          DEFAULT: 'var(--skc-danger)',
          foreground: 'var(--skc-danger-fg)',
        },
      },
      borderRadius: {
        sm: '6px',
        DEFAULT: '8px',
        md: '10px',
        lg: '12px',
        xl: '18px',
        '2xl': '24px',
      },
      fontSize: {
        '2xs': ['0.75rem', { lineHeight: '1.1rem' }],
        xs: ['0.8125rem', { lineHeight: '1.15rem' }],
        sm: ['0.875rem', { lineHeight: '1.25rem' }],
        base: ['0.9375rem', { lineHeight: '1.5rem' }],
        md: ['1rem', { lineHeight: '1.55rem' }],
        lg: ['1.125rem', { lineHeight: '1.65rem' }],
        xl: ['1.375rem', { lineHeight: '1.85rem' }],
        '2xl': ['1.75rem', { lineHeight: '2.15rem' }],
      },
      fontFamily: {
        sans: [
          'Ubuntu Sans',
          'Noto Sans CJK SC',
          'PingFang SC',
          'Microsoft YaHei',
          'system-ui',
          'sans-serif',
        ],
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'pulse-dot': {
          '0%,100%': { opacity: '0.3' },
          '50%': { opacity: '1' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 180ms ease-out',
        'accordion-up': 'accordion-up 180ms ease-out',
        'fade-in': 'fade-in 160ms ease-out',
        'pulse-dot': 'pulse-dot 1.1s ease-in-out infinite',
      },
      typography: () => ({
        DEFAULT: {
          css: {
            '--tw-prose-body': 'var(--skc-text)',
            '--tw-prose-headings': 'var(--skc-text)',
            '--tw-prose-lead': 'var(--skc-text)',
            '--tw-prose-links': 'var(--skc-accent)',
            '--tw-prose-bold': 'var(--skc-text)',
            '--tw-prose-counters': 'var(--skc-text-muted)',
            '--tw-prose-bullets': 'var(--skc-text-muted)',
            '--tw-prose-hr': 'var(--skc-border)',
            '--tw-prose-quotes': 'var(--skc-text-muted)',
            '--tw-prose-quote-borders': 'var(--skc-border-strong)',
            '--tw-prose-captions': 'var(--skc-text-muted)',
            '--tw-prose-code': 'var(--skc-text)',
            '--tw-prose-pre-code': 'var(--skc-text)',
            '--tw-prose-pre-bg': 'var(--skc-surface-hover)',
            '--tw-prose-th-borders': 'var(--skc-border)',
            '--tw-prose-td-borders': 'var(--skc-border)',
            maxWidth: 'none',
            code: {
              fontWeight: '500',
              backgroundColor: 'var(--skc-surface-hover)',
              padding: '0.15em 0.35em',
              borderRadius: '4px',
            },
            'code::before': { content: '""' },
            'code::after': { content: '""' },
            pre: {
              border: '1px solid var(--skc-border)',
            },
          },
        },
      }),
    },
  },
  plugins: [typography],
};

export default config;
