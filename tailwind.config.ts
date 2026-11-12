import type { Config } from 'tailwindcss'
import plugin from 'tailwindcss/plugin'

/**
 * Design tokens are declared as CSS custom properties in src/index.css and
 * surfaced to Tailwind here. One light theme, so the palette lives at :root and is
 * never toggled. Colours map to the `-rgb` channel triplets so opacity modifiers
 * (bg-gold/10) work; the source of truth for values is index.css.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ground: 'rgb(var(--ground-rgb) / <alpha-value>)',
        'ground-2': 'rgb(var(--ground-2-rgb) / <alpha-value>)',
        paper: 'rgb(var(--paper-rgb) / <alpha-value>)',
        'paper-dim': 'rgb(var(--paper-dim-rgb) / <alpha-value>)',
        'paper-faint': 'rgb(var(--paper-faint-rgb) / <alpha-value>)',
        gold: 'rgb(var(--gold-rgb) / <alpha-value>)',
        'gold-bright': 'rgb(var(--gold-bright-rgb) / <alpha-value>)',
        'gold-fill': 'rgb(var(--gold-fill-rgb) / <alpha-value>)',
        blue: 'rgb(var(--blue-rgb) / <alpha-value>)',
        olive: 'rgb(var(--olive-rgb) / <alpha-value>)',
        hair: 'rgb(var(--paper-rgb) / calc(0.14 * <alpha-value>))',
        'hair-strong': 'rgb(var(--paper-rgb) / calc(0.24 * <alpha-value>))',
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
  plugins: [
    // `short:` — height, not width. Enter tightens its spacing on shorter phones so the hole,
    // every player and Save fit one screen; taller phones keep the roomier default.
    plugin(({ addVariant }) => addVariant('short', '@media (max-height: 860px)')),
  ],
} satisfies Config
