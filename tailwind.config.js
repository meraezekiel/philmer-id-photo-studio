/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      // Every value maps to a token in src/styles/tokens.css, which is taken
      // from the design system in design/. Nothing here invents a colour.
      colors: {
        bg: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        panel: 'var(--panel)',
        canvas: 'var(--canvas)',
        divider: 'var(--color-divider)',
        text: 'var(--color-text)',
        muted: 'var(--muted)',
        accent: 'var(--color-accent)',
        'accent-2': 'var(--color-accent-2)',
        'accent-100': 'var(--color-accent-100)',
        'accent-600': 'var(--color-accent-600)',
        'accent-700': 'var(--color-accent-700)',
        'on-accent': 'var(--on-accent)',
        ok: 'var(--ok)',
        'ok-bg': 'var(--ok-bg)',
        'ok-line': 'var(--ok-line)',
        warn: 'var(--warn)',
        'warn-bg': 'var(--warn-bg)',
        'warn-line': 'var(--warn-line)',
        danger: 'var(--danger)',
        'danger-bg': 'var(--danger-bg)',
        'neutral-300': 'var(--color-neutral-300)',
      },
      // The system is square. Radius tokens exist only so a future retune has
      // one place to change.
      borderRadius: {
        none: '0px',
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius-md)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
      },
      boxShadow: {
        sm: 'var(--shadow-sm)',
        DEFAULT: 'var(--shadow-md)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
      },
      fontFamily: {
        sans: 'var(--font-body)',
        heading: 'var(--font-heading)',
      },
      spacing: {
        1: 'var(--space-1)',
        2: 'var(--space-2)',
        3: 'var(--space-3)',
        4: 'var(--space-4)',
        6: 'var(--space-6)',
        8: 'var(--space-8)',
      },
    },
  },
  plugins: [],
}
