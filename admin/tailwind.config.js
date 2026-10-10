/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#09090F',
        sidebar: '#101018',
        surface: '#13131C',
        card: '#171722',
        elevated: '#1E1E2B',
        line: 'rgba(255,255,255,0.07)',
        primary: { DEFAULT: '#8B5CF6', soft: '#A78BFA', deep: '#6D28D9' },
        secondary: { DEFAULT: '#22D3EE', soft: '#67E8F9' },
        ink: '#F8FAFC',
        muted: '#9494A8',
        success: '#22C55E',
        warning: '#F59E0B',
        danger: '#EF4444',
      },
      fontFamily: {
        sans: ['Manrope', 'system-ui', 'sans-serif'],
        display: ['Unbounded', 'Manrope', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        glow: '0 8px 30px -10px rgba(139,92,246,0.6)',
        card: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 16px 32px -24px rgba(0,0,0,0.9)',
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
