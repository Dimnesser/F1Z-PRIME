/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#09090F',
        surface: '#12121C',
        card: '#191925',
        line: 'rgba(255,255,255,0.07)',
        primary: { DEFAULT: '#8B5CF6', soft: '#A78BFA', deep: '#6D28D9' },
        secondary: { DEFAULT: '#22D3EE', soft: '#67E8F9' },
        ink: '#F8FAFC',
        muted: '#9494A8',
        success: '#34D399',
        warning: '#FBBF24',
        danger: '#F87171',
      },
      fontFamily: {
        sans: ['Manrope', 'system-ui', 'sans-serif'],
        display: ['Unbounded', 'Manrope', 'sans-serif'],
      },
      borderRadius: { xl2: '20px', '4xl': '28px' },
      boxShadow: {
        glow: '0 10px 40px -10px rgba(139,92,246,0.55)',
        'glow-cyan': '0 10px 40px -12px rgba(34,211,238,0.45)',
        card: '0 1px 0 0 rgba(255,255,255,0.05) inset, 0 20px 40px -24px rgba(0,0,0,0.8)',
      },
      backgroundImage: {
        brand: 'linear-gradient(135deg, #8B5CF6 0%, #6366F1 45%, #22D3EE 100%)',
        'brand-soft': 'linear-gradient(135deg, rgba(139,92,246,0.18), rgba(34,211,238,0.10))',
      },
      keyframes: {
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } },
        'spin-slow': { to: { transform: 'rotate(360deg)' } },
      },
      animation: {
        shimmer: 'shimmer 1.6s infinite',
        float: 'float 5s ease-in-out infinite',
        'spin-slow': 'spin-slow 14s linear infinite',
      },
    },
  },
  plugins: [],
}
