/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#080B12',
        sidebar: '#0B0F18',
        surface: '#0D121D',
        card: '#111624',
        elevated: '#171E2E',
        line: '#252D40',
        primary: { DEFAULT: '#756BFF', soft: '#A49DFF', deep: '#5F55E8' },
        secondary: { DEFAULT: '#34D5C5', soft: '#6FE3D7' },
        ink: '#F4F6FF',
        muted: '#929CB1',
        success: '#39D6A0',
        warning: '#FFB547',
        danger: '#FF6178',
      },
      fontFamily: {
        sans: ['Golos Text', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['Golos Text', 'system-ui', 'sans-serif'],
        // numerals with character for KPI values
        figure: ['Tektur', 'Golos Text', 'sans-serif'],
        brand: ['Unbounded', 'Golos Text', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        glow: '0 8px 24px -12px rgba(117,107,255,0.65)',
        card: '0 1px 0 0 rgba(255,255,255,0.03) inset, 0 16px 32px -26px rgba(0,0,0,0.9)',
        pop: '0 24px 60px -12px rgba(0,0,0,0.75)',
      },
      keyframes: {
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: { shimmer: 'shimmer 1.6s infinite' },
    },
  },
  plugins: [],
}
