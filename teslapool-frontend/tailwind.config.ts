import type { Config } from 'tailwindcss';

/** Design tokens (exact values from the design spec). */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: '#C1F11D', // accent lime
        dark: '#151515', // charcoal text / footer
        muted: '#797979', // secondary gray
        cream: '#FFFEE9', // page background
        cardBg: '#FFFFFF', // card surfaces
        mint: '#EBF9CF', // soft lime tint used behind illustrations
        chip: '#F1F2E8', // neutral chip background
      },
      fontFamily: {
        sans: ['var(--font-roboto)', 'Roboto', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        '2xl': '1.25rem',
        '3xl': '1.75rem',
        '4xl': '2.25rem',
      },
      boxShadow: {
        card: '0 4px 20px -2px rgba(0, 0, 0, 0.05)',
        'card-hover': '0 12px 32px -6px rgba(0, 0, 0, 0.10)',
      },
      keyframes: {
        'fade-up': { from: { opacity: '0', transform: 'translateY(8px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-up': 'fade-up 300ms ease-out both',
      },
    },
  },
  plugins: [],
};

export default config;
