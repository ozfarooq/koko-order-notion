/** @type {import('tailwindcss').Config} */
// Koko Atelier design tokens. Neutral surfaces come from CSS variables (src/index.css) so the
// same classes work in light and dark mode; plum and gold are fixed brand scales.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`

const plum = {
  50:  '#f8f2f6',
  100: '#efe0ea',
  200: '#dec1d5',
  300: '#c599b7',
  400: '#a56c93',
  500: '#874d77',
  600: '#6e3962',
  700: '#592d50',
  800: '#462441',
  900: '#351b31',
  950: '#20101d',
}

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        canvas: v('canvas'),          // page background (ivory / deep plum-black)
        surface: v('surface'),        // cards
        subtle: v('subtle'),          // table headers, hovers
        subtle2: v('subtle2'),        // stronger fills
        line: v('line'),              // borders
        'line-strong': v('line-strong'),
        ink: v('ink'),                // primary text
        'ink-soft': v('ink-soft'),    // secondary text
        muted: v('muted'),            // labels
        faint: v('faint'),            // hints, placeholders
        accent: v('accent'),          // plum that stays readable in both modes
        plum,
        brand: plum,                  // existing brand-* classes now render in Koko plum
        gold: {
          50:  '#fbf7ec',
          100: '#f5ebcc',
          200: '#ebd69b',
          300: '#dfbf6c',
          400: '#cfa84a',
          500: '#b98f33',
          600: '#9a7428',
          700: '#7a5a20',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Cormorant Garamond"', 'Georgia', 'serif'],
      },
      boxShadow: {
        soft: '0 1px 2px rgb(32 16 29 / 0.04), 0 4px 16px -4px rgb(32 16 29 / 0.08)',
        lift: '0 2px 4px rgb(32 16 29 / 0.06), 0 12px 32px -8px rgb(32 16 29 / 0.18)',
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.25rem',
      },
    },
  },
  plugins: [],
}
