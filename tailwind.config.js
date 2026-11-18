/** @type {import('tailwindcss').Config} */
// Koko Atelier design tokens — "Porcelain & Wine" (Nov 2026).
//   Page #FBFAFB porcelain · cards #FFFFFF · table headers #F6F1F3 blush tint · sidebar #1C1A1F ink
//   Text #1C1A1F ink / #7A7480 grey · primary #7B2D45 wine · highlight #C9A96E champagne · alert #D9473A
// Neutral surfaces come from CSS variables (src/index.css) so the same classes work in light and dark mode.
// The `plum` and `gold` scale names are kept so existing classes recolour everywhere: plum = wine brand scale
// (900/950 = deep ink), gold = champagne. Other utility hues are pulled into the palette below so status
// chips and charts stay harmonious on every page.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`

const wine = {
  50:  '#FBF4F6',
  100: '#F6E6EB',
  200: '#EBC9D3',
  300: '#D99DB0',
  400: '#A9506B',
  500: '#7B2D45',   // brand primary
  600: '#6A263B',
  700: '#5B2034',
  800: '#451828',
  900: '#2C2830',   // raised ink (active menu item)
  950: '#1C1A1F',   // ink
}
const champagne = {
  50:  '#FBF8F2',
  100: '#F5EEDF',
  200: '#EBDDC0',
  300: '#DDC79C',
  400: '#C9A96E',   // champagne
  500: '#B08F55',
  600: '#7A7480',   // grey text
  700: '#5E5862',
}
const alert = {
  50:  '#FDECEA', 100: '#FBDAD6', 200: '#F6B8B1', 300: '#EE9086', 400: '#E46A5E',
  500: '#D9473A', 600: '#C93C30', 700: '#B13328', 800: '#8C2920', 900: '#651E18', 950: '#360F0C',
}
const sage = {
  50:  '#DCFCE7', 100: '#DCFCE7', 200: '#BBF7D0', 300: '#86EFAC', 400: '#4ADE80',
  500: '#22A55A', 600: '#16883F', 700: '#15803D', 800: '#166534', 900: '#14532D', 950: '#052E16',
}
const warm = {   // pending / in production
  50:  '#FEF3C7', 100: '#FEF3C7', 200: '#FDE68A', 300: '#FCD34D', 400: '#F5B544',
  500: '#E39B2B', 600: '#B45309', 700: '#B45309', 800: '#92400E', 900: '#78350F', 950: '#451A03',
}
const slate = {  // neutral informational chips (cool grey with a wine bias)
  50:  '#F5F3F6', 100: '#ECE8EE', 200: '#DCD6DF', 300: '#C2BAC6', 400: '#A39BA8', 500: '#7A7480',
  600: '#625C68', 700: '#4B4651', 800: '#36323B', 900: '#24212A', 950: '#1C1A1F',
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
        'surface-accent': v('surface-accent'), // table headers (blush tint)
        line: v('line'),              // borders / row dividers
        'line-strong': v('line-strong'),
        ink: v('ink'),                // primary text (charcoal)
        'ink-soft': v('ink-soft'),
        muted: v('muted'),            // secondary text (grey)
        faint: v('faint'),            // hints, placeholders
        accent: v('accent'),          // readable wine for links/active text
        sidebar: '#1C1A1F',
        plum: wine,
        brand: { ...wine, primary: '#7B2D45', alert: '#D9473A' },
        gold: champagne,
        rose: alert, red: alert,
        emerald: sage, green: sage, teal: sage,
        amber: warm, orange: warm,
        violet: wine, purple: wine,
        sky: slate, blue: slate,
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
