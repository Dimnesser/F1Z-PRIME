/** @type {import('tailwindcss').Config} */
// Colors come from CSS variables (RGB channels) defined in src/index.css, so Tailwind opacity
// modifiers work and the whole palette switches between the dark and light theme in one place.
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        surface: v('surface'),
        elevated: v('elevated'),
        card: v('surface'),
        line: v('line'),
        ov: v('ov'),
        // fixed light ink for content on objects that stay dark in both themes (the SIM card, photo overlays)
        snow: '#F4F6FF',
        primary: { DEFAULT: v('primary'), soft: v('primary-soft'), ink: v('on-primary') },
        accent: v('accent'),
        secondary: { DEFAULT: v('accent'), soft: v('accent') },
        ink: v('ink'),
        muted: v('muted'),
        success: v('success'),
        warning: v('warning'),
        danger: v('danger'),
      },
      fontFamily: {
        sans: ['Golos Text', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        // numerals with character: balance, prices on hero surfaces, phone numbers, SMS codes
        display: ['Tektur', 'Golos Text', 'system-ui', 'sans-serif'],
        brand: ['Unbounded', 'Golos Text', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': ['11px', '14px'],
      },
      borderRadius: { xl2: '20px', '4xl': '28px' },
      boxShadow: {
        card: 'var(--shadow-card)',
        pop: 'var(--shadow-pop)',
        glow: '0 10px 30px -12px rgb(var(--primary) / 0.55)',
        'glow-accent': '0 10px 30px -14px rgb(var(--accent) / 0.5)',
      },
      backgroundImage: {
        brand: 'linear-gradient(135deg, rgb(var(--primary)) 0%, #5B6CFF 55%, rgb(var(--accent)) 130%)',
        'brand-soft': 'linear-gradient(135deg, rgb(var(--primary) / 0.16), rgb(var(--accent) / 0.08))',
      },
      transitionTimingFunction: { out: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
      keyframes: {
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
  plugins: [],
}
