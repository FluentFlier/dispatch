import type { MetadataRoute } from 'next';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://contentos.us';

/** Keep the app surface (dashboard, admin, auth, share links) out of search. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/admin/',
          '/admin',
          '/auth/',
          '/login',
          '/d/',
          '/dashboard',
          '/onboarding',
          '/get-started',
          '/generate',
          '/library',
          '/calendar',
          '/inbox',
          '/leads',
          '/analytics',
          '/ideas',
          '/brain',
          '/signals',
          '/story-bank',
          '/series',
          '/settings',
          '/voice-lab',
          '/video-studio',
          '/teleprompter',
          '/event-capture',
        ],
      },
    ],
    sitemap: `${BASE_URL}/sitemap.xml`,
  };
}
