import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/app/**/*.{ts,tsx}',
    './src/components/**/*.{ts,tsx}',
    './src/lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // --- Content Relay palette (var-backed so a `.dark` class flips them) ---
        paper: 'rgb(var(--paper) / <alpha-value>)',
        paper2: 'rgb(var(--paper2) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        ink2: 'rgb(var(--ink2) / <alpha-value>)',
        ink3: 'rgb(var(--ink3) / <alpha-value>)',
        hair: 'var(--hair)',
        hair2: 'var(--hair2)',
        blue: { DEFAULT: 'oklch(57% 0.24 260)', dark: 'oklch(47% 0.22 260)' },
        teal: 'oklch(44% 0.1 145)',
        flame: 'oklch(62% 0.2 35)',
        lime: 'oklch(84% 0.2 125)',
        lilac: 'oklch(76% 0.12 305)',
        bg: {
          primary: 'rgb(var(--bg-primary-rgb) / <alpha-value>)',
          secondary: 'rgb(var(--bg-secondary-rgb) / <alpha-value>)',
          tertiary: 'rgb(var(--bg-tertiary-rgb) / <alpha-value>)',
          elevated: 'rgb(var(--bg-elevated-rgb) / <alpha-value>)',
        },
        text: {
          primary: 'rgb(var(--text-primary-rgb) / <alpha-value>)',
          secondary: 'rgb(var(--text-secondary-rgb) / <alpha-value>)',
          tertiary: 'rgb(var(--text-tertiary-rgb) / <alpha-value>)',
          inverse: 'rgb(var(--text-inverse-rgb) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'rgb(var(--border-rgb) / 0.1)',
          primary: 'rgb(var(--border-rgb) / 0.1)',
          hover: 'rgb(var(--border-rgb) / 0.2)',
          active: 'rgb(var(--border-rgb) / 0.3)',
        },
        accent: {
          primary: 'rgb(var(--accent-rgb) / <alpha-value>)',
          secondary: '#0F766E',
          light: 'rgb(var(--accent-rgb) / 0.1)',
          dark: 'rgb(var(--accent-dark-rgb) / <alpha-value>)',
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
        display: ['var(--font-hanken)', 'system-ui', 'sans-serif'],
        heading: ['var(--font-hanken)', 'system-ui', 'sans-serif'],
        body: ['var(--font-hanken)', 'system-ui', 'sans-serif'],
        serif: ['var(--font-fraunces)', 'Georgia', 'serif'],
        grotesk: ['var(--font-hanken)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-jetbrains)', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        base: ['15px', { lineHeight: '1.55' }],
      },
      borderRadius: {
        // Content OS radius ladder (DESIGN.md §5): chip 8 · control 10 ·
        // compact-card 14 · surface 18 · poster 22. Controls are squared with
        // gentle corners - never default pills.
        md: '6px',
        lg: '8px',
        badge: '8px',
        control: '10px',
        card: '14px',
        surface: '18px',
        poster: '22px',
        pill: '999px',
      },
      boxShadow: {
        card: '0 20px 50px -30px rgba(23, 23, 23, 0.12)',
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
        'ed-blink': {
          '0%, 49%': { opacity: '1' },
          '50%, 100%': { opacity: '0' },
        },
        'ed-pulse': {
          '0%, 100%': { opacity: '0.4' },
          '50%': { opacity: '1' },
        },
        'land-kenburns': {
          '0%': { transform: 'scale(1.05) translate3d(0, 0, 0)' },
          '100%': { transform: 'scale(1.12) translate3d(-1%, -1%, 0)' },
        },
        'land-drift-a': {
          '0%, 100%': { transform: 'translate3d(0, 0, 0)' },
          '50%': { transform: 'translate3d(4%, -3%, 0)' },
        },
        'land-drift-b': {
          '0%, 100%': { transform: 'translate3d(0, 0, 0)' },
          '50%': { transform: 'translate3d(-5%, 4%, 0)' },
        },
        'land-drift-c': {
          '0%, 100%': { transform: 'translate3d(0, 0, 0)' },
          '50%': { transform: 'translate3d(3%, 5%, 0)' },
        },
        'land-mesh': {
          '0%': { opacity: '0.25', transform: 'scale(1) translate3d(0, 0, 0)' },
          '100%': { opacity: '0.45', transform: 'scale(1.04) translate3d(-1%, 1%, 0)' },
        },
        'land-float': {
          '0%, 100%': { transform: 'translate3d(0, 0, 0)' },
          '50%': { transform: 'translate3d(0, -10px, 0)' },
        },
        'land-silk-sheen': {
          '0%': { transform: 'translateX(-120%) skewX(-12deg)', opacity: '0' },
          '8%': { opacity: '0.55' },
          '45%': { opacity: '0.35' },
          '100%': { transform: 'translateX(220%) skewX(-12deg)', opacity: '0' },
        },
        'land-silk-breathe': {
          '0%, 100%': { transform: 'scale(1.05)' },
          '50%': { transform: 'scale(1.08)' },
        },
      },
      animation: {
        'os-marquee': 'os-marquee 46s linear infinite',
        'os-aurora-slow': 'os-aurora 26s ease-in-out infinite',
        'os-aurora-slower': 'os-aurora 38s ease-in-out infinite',
        'os-pulse-dot': 'os-pulse-dot 2.4s ease-in-out infinite',
        'os-shimmer': 'os-shimmer 6s linear infinite',
        'ed-blink': 'ed-blink 1s step-end infinite',
        'ed-pulse': 'ed-pulse 2s ease-in-out infinite',
        'land-kenburns': 'land-kenburns 28s ease-in-out infinite alternate',
        'land-drift-a': 'land-drift-a 18s ease-in-out infinite',
        'land-drift-b': 'land-drift-b 22s ease-in-out infinite',
        'land-drift-c': 'land-drift-c 26s ease-in-out infinite',
        'land-mesh': 'land-mesh 20s ease-in-out infinite alternate',
        'land-float': 'land-float 5s ease-in-out infinite',
        'land-silk-sheen': 'land-silk-sheen 9s ease-in-out infinite',
        'land-silk-breathe': 'land-silk-breathe 14s ease-in-out infinite alternate',
      },
    },
  },
  plugins: [],
};

export default config;
