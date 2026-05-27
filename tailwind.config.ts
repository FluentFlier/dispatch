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
          primary: '#FAF7F2',
          secondary: '#FFFFFF',
          tertiary: '#F3EDE4',
          elevated: '#FFFDF9',
        },
        text: {
          primary: '#1C1917',
          secondary: '#57534E',
          tertiary: '#78716C',
          inverse: '#FFFDF9',
        },
        border: {
          DEFAULT: 'rgba(28, 25, 23, 0.1)',
          primary: 'rgba(28, 25, 23, 0.1)',
          hover: 'rgba(28, 25, 23, 0.18)',
          active: 'rgba(28, 25, 23, 0.28)',
        },
        accent: {
          primary: '#E07A5F',
          secondary: '#3D8B7A',
          light: 'rgba(224, 122, 95, 0.14)',
          dark: '#C45C48',
        },
        coral: {
          DEFAULT: '#E07A5F',
          light: 'rgba(224, 122, 95, 0.14)',
          dark: '#C45C48',
        },
        sage: {
          DEFAULT: '#3D8B7A',
          light: 'rgba(61, 139, 122, 0.14)',
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
        lg: '16px',
        md: '10px',
        badge: '6px',
        pill: '999px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(28, 25, 23, 0.04), 0 4px 16px rgba(28, 25, 23, 0.06)',
        soft: '0 2px 12px rgba(224, 122, 95, 0.12)',
      },
    },
  },
  plugins: [],
};

export default config;
