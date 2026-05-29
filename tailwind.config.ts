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
      },
    },
  },
  plugins: [],
};

export default config;
