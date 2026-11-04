import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        slate9: '#0F2A33', // sidebar / chrome
        slate8: '#173B47',
        paper: '#F3F5F4',
        ink: '#17202B',
        lens: '#E39B2B', // primary accent
        ok: '#2E8B6A',
        warn: '#B7791F',
        bad: '#C4452F',
      },
      fontFamily: {
        sans: ['"Segoe UI Variable"', '"Segoe UI"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
