import type { Config } from 'tailwindcss';
import typography from '@tailwindcss/typography';

/* ---------------------------------------------------------------
 * Typeface stacks
 *
 * Three roles, picked from system-installed fonts on every platform
 * so we get a real upscale feel without paying a webfont round-trip.
 *
 *   - sans  → body, UI chrome
 *   - serif → headings (editorial / literary feel; pairs with CJK Songti)
 *   - mono  → code blocks, inline code, kbd
 *
 * Order matters: Latin face first so Latin glyphs land on the high-end
 * Western face, then CJK fallbacks pick up Chinese characters from the
 * matching CJK family. This is the "Apple-style mixed-script" pattern.
 * ------------------------------------------------------------- */
const FONT_SANS = [
  '-apple-system',
  'BlinkMacSystemFont',
  '"Segoe UI Variable Text"',
  '"Segoe UI"',
  'Inter',
  'Roboto',
  'Ubuntu',
  '"PingFang SC"',
  '"Hiragino Sans GB"',
  '"Source Han Sans SC"',
  '"Noto Sans CJK SC"',
  '"Microsoft YaHei"',
  'system-ui',
  'sans-serif',
].join(', ');

const FONT_SERIF = [
  '"Source Serif 4"',
  '"Source Serif Pro"',
  'Charter',
  '"Iowan Old Style"',
  '"Palatino Linotype"',
  'Cambria',
  'Georgia',
  '"Source Han Serif SC"',
  '"Noto Serif CJK SC"',
  '"Songti SC"',
  'STSong',
  'SimSun',
  'serif',
].join(', ');

const FONT_MONO = [
  '"JetBrains Mono"',
  '"Fira Code"',
  '"SF Mono"',
  'ui-monospace',
  'SFMono-Regular',
  '"Cascadia Code"',
  'Menlo',
  'Consolas',
  '"Liberation Mono"',
  'monospace',
].join(', ');

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
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI Variable Text',
          'Segoe UI',
          'Inter',
          'Roboto',
          'Ubuntu',
          'PingFang SC',
          'Hiragino Sans GB',
          'Source Han Sans SC',
          'Noto Sans CJK SC',
          'Microsoft YaHei',
          'system-ui',
          'sans-serif',
        ],
        serif: [
          'Source Serif 4',
          'Source Serif Pro',
          'Charter',
          'Iowan Old Style',
          'Palatino Linotype',
          'Cambria',
          'Georgia',
          'Source Han Serif SC',
          'Noto Serif CJK SC',
          'Songti SC',
          'STSong',
          'SimSun',
          'serif',
        ],
        mono: [
          'JetBrains Mono',
          'Fira Code',
          'SF Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Cascadia Code',
          'Menlo',
          'Consolas',
          'Liberation Mono',
          'monospace',
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
            '--tw-prose-bullets': 'var(--border-strong)',
            '--tw-prose-hr': 'var(--border)',
            '--tw-prose-quotes': 'var(--text-muted)',
            '--tw-prose-quote-borders': 'var(--accent)',
            '--tw-prose-captions': 'var(--text-muted)',
            '--tw-prose-code': 'var(--text)',
            '--tw-prose-pre-code': 'var(--text)',
            '--tw-prose-pre-bg': 'var(--surface-hover)',
            '--tw-prose-th-borders': 'var(--border-strong)',
            '--tw-prose-td-borders': 'var(--border)',
            maxWidth: 'none',
          },
        },
        // Chat-tuned prose. Use as `prose prose-chat` (no `prose-sm`).
        // Designed for refined reading rhythm in CJK+EN mixed chat content.
        chat: {
          css: {
            fontSize: '0.9375rem',
            lineHeight: '1.65',
            color: 'var(--tw-prose-body)',

            // Paragraph spacing — tighter than default prose
            p: {
              marginTop: '0',
              marginBottom: '0.65em',
            },

            // Heading scale — refined, not oversized.
            // h1–h4 use a serif stack for editorial weight; h5/h6 stay sans
            // because at small sizes serif feels noisy.
            'h1, h2, h3, h4, h5, h6': {
              color: 'var(--tw-prose-headings)',
              fontWeight: '600',
              letterSpacing: '-0.005em',
              lineHeight: '1.4',
              scrollMarginTop: '4rem',
              fontFeatureSettings: '"kern", "liga", "calt"',
            },
            'h1, h2, h3, h4': {
              fontFamily: FONT_SERIF,
            },
            h1: {
              fontSize: '1.4em',
              fontWeight: '700',
              marginTop: '1.3em',
              marginBottom: '0.5em',
              paddingBottom: '0.3em',
              borderBottom: '1px solid var(--border)',
            },
            h2: {
              fontSize: '1.2em',
              fontWeight: '700',
              marginTop: '1.2em',
              marginBottom: '0.4em',
            },
            h3: {
              fontSize: '1.075em',
              fontWeight: '600',
              marginTop: '1.05em',
              marginBottom: '0.3em',
            },
            h4: {
              fontSize: '1em',
              fontWeight: '600',
              marginTop: '0.95em',
              marginBottom: '0.25em',
            },
            h5: {
              fontSize: '0.95em',
              fontWeight: '600',
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              marginTop: '0.95em',
              marginBottom: '0.25em',
            },
            h6: {
              fontSize: '0.875em',
              fontWeight: '600',
              color: 'var(--text-muted)',
              marginTop: '0.9em',
              marginBottom: '0.25em',
            },

            // Lead-in: avoid huge top gap on the first heading
            ':where(h1, h2, h3, h4, h5, h6):first-child': {
              marginTop: '0',
            },

            // Lists — tighter rhythm, subtler markers
            'ul, ol': {
              marginTop: '0.35em',
              marginBottom: '0.65em',
              paddingLeft: '1.4em',
            },
            li: {
              marginTop: '0.1em',
              marginBottom: '0.1em',
              paddingLeft: '0.2em',
              lineHeight: '1.6',
            },
            'li > p': {
              marginTop: '0.25em',
              marginBottom: '0.25em',
            },
            'ul > li::marker': {
              color: 'var(--tw-prose-bullets)',
            },
            'ol > li::marker': {
              color: 'var(--text-muted)',
              fontWeight: '500',
            },
            'li > ul, li > ol': {
              marginTop: '0.15em',
              marginBottom: '0.15em',
            },

            // Inline emphasis
            strong: {
              color: 'var(--tw-prose-bold)',
              fontWeight: '600',
            },
            em: { fontStyle: 'italic' },

            // Links — accent color with a soft underline that brightens on hover
            a: {
              color: 'var(--tw-prose-links)',
              fontWeight: '500',
              textDecoration: 'none',
              borderBottom: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
              transition: 'border-color 120ms ease, color 120ms ease',
            },
            'a:hover': {
              borderBottomColor: 'var(--accent)',
            },

            // Inline code — softly bordered chip
            code: {
              fontWeight: '500',
              fontSize: '0.86em',
              fontFamily: FONT_MONO,
              fontVariantNumeric: 'tabular-nums',
              backgroundColor: 'var(--surface-hover)',
              color: 'var(--text)',
              padding: '0.12em 0.4em',
              borderRadius: '5px',
              border: '1px solid var(--border)',
            },
            'code::before': { content: '""' },
            'code::after': { content: '""' },

            // Block code — flat container; the React component renders the chrome.
            pre: {
              marginTop: '0.7em',
              marginBottom: '0.7em',
              padding: '0',
              border: '1px solid var(--border)',
              borderRadius: '10px',
              backgroundColor: 'var(--surface-hover)',
              color: 'var(--text)',
              overflow: 'hidden',
              fontSize: '0.86em',
              lineHeight: '1.55',
              fontFamily: FONT_MONO,
              fontVariantNumeric: 'tabular-nums',
              fontFeatureSettings: '"calt", "liga"',
            },
            'kbd, samp': {
              fontFamily: FONT_MONO,
            },
            'pre code': {
              display: 'block',
              padding: '0.75em 1em',
              backgroundColor: 'transparent',
              border: 'none',
              borderRadius: '0',
              fontWeight: '400',
              fontSize: 'inherit',
              color: 'inherit',
              overflowX: 'auto',
            },

            // Blockquote — accent rail, editorial serif feel
            blockquote: {
              marginTop: '0.75em',
              marginBottom: '0.75em',
              paddingLeft: '0.9em',
              borderLeftWidth: '3px',
              borderLeftColor: 'var(--tw-prose-quote-borders)',
              fontFamily: FONT_SERIF,
              fontStyle: 'italic',
              fontWeight: '400',
              color: 'var(--tw-prose-quotes)',
              quotes: 'none',
              lineHeight: '1.65',
            },
            'blockquote p': {
              marginTop: '0.2em',
              marginBottom: '0.2em',
            },
            'blockquote p:first-of-type::before': { content: 'none' },
            'blockquote p:last-of-type::after': { content: 'none' },

            // Horizontal rule — subtle
            hr: {
              marginTop: '1.4em',
              marginBottom: '1.4em',
              borderTopWidth: '1px',
              borderColor: 'var(--tw-prose-hr)',
            },

            // Tables — zebra rows, sticky-feel header. The React `table` override
            // provides the rounded scroll container, so styles here target inner cells.
            table: {
              width: '100%',
              fontSize: '0.875em',
              lineHeight: '1.5',
              marginTop: '0',
              marginBottom: '0',
              borderCollapse: 'collapse',
              fontVariantNumeric: 'tabular-nums lining-nums',
            },
            thead: {
              borderBottomWidth: '0',
            },
            'thead th': {
              fontWeight: '600',
              padding: '0.45em 0.8em',
              backgroundColor: 'var(--surface-hover)',
              color: 'var(--text)',
              textAlign: 'left',
              borderBottom: '1px solid var(--tw-prose-th-borders)',
            },
            'tbody tr': {
              borderBottomWidth: '1px',
              borderBottomColor: 'var(--tw-prose-td-borders)',
            },
            'tbody tr:nth-child(even)': {
              backgroundColor: 'color-mix(in srgb, var(--surface-hover) 45%, transparent)',
            },
            'tbody tr:last-child': {
              borderBottomWidth: '0',
            },
            'tbody td': {
              padding: '0.45em 0.8em',
              verticalAlign: 'top',
            },

            // Images
            img: {
              marginTop: '0.7em',
              marginBottom: '0.7em',
              borderRadius: '8px',
              border: '1px solid var(--border)',
            },

            // Task list checkboxes (GFM)
            'input[type="checkbox"]': {
              marginRight: '0.45em',
              transform: 'translateY(1px)',
              accentColor: 'var(--accent)',
            },

            // Detail/summary
            details: {
              marginTop: '0.85em',
              marginBottom: '0.85em',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              padding: '0.5em 0.85em',
              backgroundColor: 'var(--surface)',
            },
            summary: {
              cursor: 'pointer',
              fontWeight: '500',
              color: 'var(--text)',
            },

            // First/last child margin reset — prevents extra space inside a bubble
            '> :first-child': { marginTop: '0' },
            '> :last-child': { marginBottom: '0' },
          },
        },
      }),
    },
  },
  plugins: [typography],
};

export default config;
