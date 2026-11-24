import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        base: '#090C13',
        panel: '#10141F',
        raised: '#161B29',
        line: '#222A3D',
        text: '#E8EBF4',
        muted: '#8B94AA',
        faint: '#5B6479',
        accent: '#7C6CFF',
        accent2: '#22D3EE',
        ok: '#34D399',
        warn: '#FBBF24',
        bad: '#F87171',
      },
      fontFamily: {
        sans: ['"Segoe UI Variable Text"', '"Segoe UI"', 'system-ui', 'sans-serif'],
        display: ['"Segoe UI Variable Display"', '"Segoe UI"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(124,108,255,.35), 0 8px 30px -8px rgba(124,108,255,.45)',
        card: '0 1px 0 rgba(255,255,255,.03) inset, 0 10px 30px -18px rgba(0,0,0,.8)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'none' } },
        'pulse-ring': { '0%': { boxShadow: '0 0 0 0 rgba(52,211,153,.5)' }, '100%': { boxShadow: '0 0 0 8px rgba(52,211,153,0)' } },
      },
      animation: {
        'fade-in': 'fade-in .25s ease-out both',
        'pulse-ring': 'pulse-ring 1.6s ease-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
