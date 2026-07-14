import type { MetadataRoute } from 'next';

/**
 * PWA web app manifest. Editorial palette: ink theme color, paper background.
 * Uses the SVG favicon (app/icon.svg) as the app icon.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Content OS',
    short_name: 'Content OS',
    description:
      'The self-improving content command center for creators who ship - generate, schedule, publish, reply, and learn across X, LinkedIn, Instagram, and Threads.',
    start_url: '/',
    display: 'standalone',
    background_color: '#FBFAF7',
    theme_color: '#171717',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}
