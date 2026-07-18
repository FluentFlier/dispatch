import type { MetadataRoute } from 'next';
import { absoluteUrl } from '@/lib/seo';

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
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}
