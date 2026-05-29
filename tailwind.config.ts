import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          primary: '#F6F7F4',
          secondary: '#FFFFFF',
          tertiary: '#EEF1ED',
          elevated: '#FBFCFA',
        },
        text: {
          primary: '#171717',
          secondary: '#525252',
          tertiary: '#737373',
          inverse: '#FFFFFF',
        },
        border: {
          DEFAULT: 'rgba(23, 23, 23, 0.1)',
          primary: 'rgba(23, 23, 23, 0.1)',
          hover: 'rgba(23, 23, 23, 0.2)',
          active: 'rgba(23, 23, 23, 0.3)',
        },
        accent: {
          primary: '#2563EB',
          secondary: '#0F766E',
          light: 'rgba(37, 99, 235, 0.1)',
          dark: '#1D4ED8',
        },
        coral: {
          DEFAULT: '#E07A5F',
          light: 'rgba(224, 122, 95, 0.14)',
          dark: '#C45C48',
        },
        sage: {
          DEFAULT: '#0F766E',
          light: 'rgba(15, 118, 110, 0.1)',
        },
        os: {
          bg: '#07080A',
          elevated: '#0D0F13',
          surface: 'rgba(20, 22, 27, 0.72)',
          'surface-strong': '#151820',
          text: '#F4F0E8',
          soft: '#C9C0B3',
          muted: '#7F776C',
          border: 'rgba(244, 240, 232, 0.12)',
          'border-strong': 'rgba(244, 240, 232, 0.22)',
          coral: '#FF6B4A',
          cyan: '#5BE7D8',
          gold: '#D7B56D',
          lime: '#B8F36A',
        },
        pillar: {
          'hot-take': '#DC6B5C',
          hackathon: '#D4A054',
          founder: '#E07A5F',
          explainer: '#8B7BB8',
          origin: '#3D8B7A',
          research: '#5B8FA8',
        },
      },
      fontFamily: {
        display: ['DM Sans', 'system-ui', 'sans-serif'],
        heading: ['DM Sans', 'system-ui', 'sans-serif'],
        body: ['DM Sans', 'system-ui', 'sans-serif'],
        serif: ['var(--font-fraunces)', 'Georgia', 'serif'],
        grotesk: ['var(--font-hanken)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains)', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        base: ['15px', { lineHeight: '1.55' }],
      },
      borderRadius: {
        lg: '8px',
        md: '6px',
        badge: '6px',
        pill: '999px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(23, 23, 23, 0.05), 0 8px 24px rgba(23, 23, 23, 0.05)',
        soft: '0 8px 24px rgba(37, 99, 235, 0.12)',
        glass: '0 1px 0 rgba(244,240,232,0.06) inset, 0 24px 60px -24px rgba(0,0,0,0.7)',
      },
      keyframes: {
        'os-marquee': {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(-50%)' },
        },
        'os-aurora': {
          '0%, 100%': { transform: 'translate3d(0,0,0) scale(1)' },
          '33%': { transform: 'translate3d(4%,-3%,0) scale(1.08)' },
          '66%': { transform: 'translate3d(-3%,4%,0) scale(0.96)' },
        },
        'os-pulse-dot': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.45', transform: 'scale(0.82)' },
        },
        'os-shimmer': {
          '0%': { backgroundPosition: '200% center' },
          '100%': { backgroundPosition: '-200% center' },
        },
      },
      animation: {
        'os-marquee': 'os-marquee 46s linear infinite',
        'os-aurora-slow': 'os-aurora 26s ease-in-out infinite',
        'os-aurora-slower': 'os-aurora 38s ease-in-out infinite',
        'os-pulse-dot': 'os-pulse-dot 2.4s ease-in-out infinite',
        'os-shimmer': 'os-shimmer 6s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
