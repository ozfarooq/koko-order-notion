/** @type {import('tailwindcss').Config} */
// Koko Atelier design tokens — "Minimal Yet Warm".
//   Canvas #EAE7DC eggshell · cards #FFFFFF · accent surfaces #D8C3A5 dark vanilla · sidebar #1F1F1E obsidian
//   Text #2C2C2A charcoal / #8E8D8A taupe · primary #E98074 coral · alert #E85A4F jelly-bean red
// Neutral surfaces come from CSS variables (src/index.css) so the same classes work in light and dark mode.
// The `plum` and `gold` scale names are kept so existing classes recolour everywhere: plum = coral/terracotta
// brand scale (900/950 = charcoal/obsidian), gold = vanilla/sand → taupe. Other utility hues are pulled into
// the palette below so status chips and charts stay harmonious on every page.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`

const coral = {
  50:  '#FDF4F2',
  100: '#FAE3DF',
  200: '#F5C8C1',
  300: '#EFA99F',
  400: '#EC9488',
  500: '#E98074',   // brand primary
  600: '#D96A5D',
  700: '#B9544A',
  800: '#8F3F36',
  900: '#2C2C2A',   // charcoal
  950: '#1F1F1E',   // obsidian
}
const sand = {
  50:  '#F6F2EA',
  100: '#EFE7DA',
  200: '#E5D7C2',
  300: '#DDCCB2',
  400: '#D8C3A5',   // dark vanilla
  500: '#B8A487',
  600: '#8E8D8A',   // taupe gray
  700: '#6E6C68',
}
const alert = {
  50:  '#FEE2E2', 100: '#FDD5D0', 200: '#F9B9B1', 300: '#F29589', 400: '#EC7468',
  500: '#E85A4F', 600: '#E85A4F', 700: '#D04A3F', 800: '#A33B33', 900: '#7A2C26', 950: '#3D1613',
}
const sage = {
  50:  '#DCFCE7', 100: '#DCFCE7', 200: '#BBF7D0', 300: '#86EFAC', 400: '#4ADE80',
  500: '#22A55A', 600: '#16883F', 700: '#15803D', 800: '#166534', 900: '#14532D', 950: '#052E16',
}
const warm = {   // pending / in production
  50:  '#FEF3C7', 100: '#FEF3C7', 200: '#FDE68A', 300: '#FCD34D', 400: '#F5B544',
  500: '#E39B2B', 600: '#B45309', 700: '#B45309', 800: '#92400E', 900: '#78350F', 950: '#451A03',
}
const taupe = {  // neutral informational chips
  50:  '#F3EFE7', 100: '#E9E2D5', 200: '#DDD3C3', 300: '#C4B79F', 400: '#A9A08F', 500: '#8E8D8A',
  600: '#76736D', 700: '#5F5D59', 800: '#45443F', 900: '#2C2C2A', 950: '#1F1F1E',
}

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        canvas: v('canvas'),          // page background (eggshell / obsidian)
        surface: v('surface'),        // cards, menus, dialogs (white)
        card: v('surface'),
        subtle: v('subtle'),          // hovers, quiet fills
        subtle2: v('subtle2'),        // stronger fills
        'surface-accent': v('surface-accent'), // table headers (dark vanilla)
        line: v('line'),              // borders / row dividers
        'line-strong': v('line-strong'),
        ink: v('ink'),                // primary text (charcoal)
        'ink-soft': v('ink-soft'),
        muted: v('muted'),            // secondary text (taupe)
        faint: v('faint'),            // hints, placeholders
        accent: v('accent'),          // readable coral for links/active text
        sidebar: '#1F1F1E',
        plum: coral,
        brand: { ...coral, primary: '#E98074', alert: '#E85A4F' },
        gold: sand,
        rose: alert, red: alert,
        emerald: sage, green: sage, teal: sage,
        amber: warm, orange: warm,
        violet: coral, purple: coral,
        sky: taupe, blue: taupe,
      },
      fontFamily: {
        // Inter throughout; headings differ by size, weight and tracking rather than typeface
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Inter', 'system-ui', 'sans-serif'],
        serif: ['Inter', 'system-ui', 'sans-serif'],
        label: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['Inter', 'system-ui', 'sans-serif'],   // kbd/code too
      },
      boxShadow: {
        soft: '0 1px 2px rgb(44 44 42 / 0.04), 0 4px 16px -6px rgb(44 44 42 / 0.08)',
        lift: '0 2px 4px rgb(44 44 42 / 0.06), 0 12px 32px -8px rgb(44 44 42 / 0.16)',
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.25rem',
      },
    },
  },
  plugins: [],
}
