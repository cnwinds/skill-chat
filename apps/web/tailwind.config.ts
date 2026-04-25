import type { Config } from 'tailwindcss';
import typography from '@tailwindcss/typography';

const config: Config = {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1rem',
    },
    extend: {
      colors: {
        background: 'var(--background)',
        surface: 'var(--surface)',
        'surface-hover': 'var(--surface-hover)',
        border: 'var(--border)',
        'border-strong': 'var(--border-strong)',
        foreground: 'var(--text)',
        'foreground-muted': 'var(--text-muted)',
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: 'var(--accent-fg)',
        },
        danger: {
          DEFAULT: 'var(--danger)',
          foreground: 'var(--danger-fg)',
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
            '--tw-prose-body': 'var(--text)',
            '--tw-prose-headings': 'var(--text)',
            '--tw-prose-lead': 'var(--text)',
            '--tw-prose-links': 'var(--accent)',
            '--tw-prose-bold': 'var(--text)',
            '--tw-prose-counters': 'var(--text-muted)',
            '--tw-prose-bullets': 'var(--text-muted)',
            '--tw-prose-hr': 'var(--border)',
            '--tw-prose-quotes': 'var(--text-muted)',
            '--tw-prose-quote-borders': 'var(--border-strong)',
            '--tw-prose-captions': 'var(--text-muted)',
            '--tw-prose-code': 'var(--text)',
            '--tw-prose-pre-code': 'var(--text)',
            '--tw-prose-pre-bg': 'var(--surface-hover)',
            '--tw-prose-th-borders': 'var(--border)',
            '--tw-prose-td-borders': 'var(--border)',
            maxWidth: 'none',
            code: {
              fontWeight: '500',
              backgroundColor: 'var(--surface-hover)',
              padding: '0.15em 0.35em',
              borderRadius: '4px',
            },
            'code::before': { content: '""' },
            'code::after': { content: '""' },
            pre: {
              border: '1px solid var(--border)',
            },
          },
        },
      }),
    },
  },
  plugins: [typography],
};

export default config;
