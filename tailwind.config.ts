import type { Config } from 'tailwindcss'

/**
 * Design tokens are declared as CSS custom properties in src/index.css and
 * surfaced to Tailwind here. Dark-mode only — there is no light theme — so the
 * palette lives at :root and is never toggled. Keep this file a thin mapping;
 * the source of truth for values is index.css.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ground: 'var(--ground)',
        'ground-2': 'var(--ground-2)',
        paper: 'var(--paper)',
        'paper-dim': 'var(--paper-dim)',
        'paper-faint': 'var(--paper-faint)',
        gold: 'var(--gold)',
        'gold-bright': 'var(--gold-bright)',
        blue: 'var(--blue)',
        olive: 'var(--olive)',
        hair: 'var(--hair)',
        'hair-strong': 'var(--hair-strong)',
      },
      fontFamily: {
        display: ['"Fraunces Variable"', 'Georgia', 'serif'],
        sans: ['"Inter Variable"', 'system-ui', '-apple-system', 'sans-serif'],
      },
      borderColor: {
        DEFAULT: 'var(--hair)',
      },
    },
  },
  plugins: [],
} satisfies Config
