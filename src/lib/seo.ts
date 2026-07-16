import type { Metadata } from 'next';
import { PRODUCT_NAME, SITE_TITLE } from '@/lib/brand';

export const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL || 'https://contentos.us').replace(/\/$/, '');

export const SITE_DESCRIPTION =
  'Create in your voice, publish to LinkedIn and X, reply faster, and turn engagement into what you do next.';

export type PublicSeoPage = {
  path: string;
  title: string;
  description: string;
  changeFrequency: 'weekly' | 'monthly' | 'yearly';
  priority: number;
};

export const PUBLIC_SEO_PAGES: PublicSeoPage[] = [
  {
    path: '/',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    changeFrequency: 'weekly',
    priority: 1,
  },
  {
    path: '/features',
    title: 'Features',
    description:
      'Plan, draft, publish, reply, and learn from social content performance in one creator command center.',
    changeFrequency: 'weekly',
    priority: 0.95,
  },
  {
    path: '/use-cases',
    title: 'Use cases',
    description:
      'See how founders, creators, consultants, and small teams use Content OS to turn consistent publishing into pipeline.',
    changeFrequency: 'weekly',
    priority: 0.9,
  },
  {
    path: '/templates',
    title: 'Content templates',
    description:
      'Practical LinkedIn and X content templates for hooks, launches, founder stories, replies, and weekly planning.',
    changeFrequency: 'weekly',
    priority: 0.9,
  },
  {
    path: '/compare',
    title: 'Compare Content OS',
    description:
      'Compare Content OS with schedulers, writing tools, and spreadsheets for creator-led content operations.',
    changeFrequency: 'monthly',
    priority: 0.85,
  },
  {
    path: '/pricing',
    title: 'Pricing',
    description: `Simple plans for creators at every stage. Start a free ${PRODUCT_NAME} trial and publish with a connected content system.`,
    changeFrequency: 'weekly',
    priority: 0.9,
  },
  {
    path: '/book-demo',
    title: 'Book a demo',
    description: `Schedule a founder-led walkthrough of ${PRODUCT_NAME}.`,
    changeFrequency: 'monthly',
    priority: 0.8,
  },
  {
    path: '/privacy',
    title: 'Privacy Policy',
    description: `Privacy policy for ${PRODUCT_NAME}.`,
    changeFrequency: 'yearly',
    priority: 0.2,
  },
  {
    path: '/terms',
    title: 'Terms of Service',
    description: `Terms of service for ${PRODUCT_NAME}.`,
    changeFrequency: 'yearly',
    priority: 0.2,
  },
];

export function absoluteUrl(path = '/'): string {
  return path.startsWith('http') ? path : `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

export function pageMetadata(page: Pick<PublicSeoPage, 'path' | 'title' | 'description'>): Metadata {
  const title = page.path === '/' ? SITE_TITLE : page.title;

  return {
    title,
    description: page.description,
    alternates: {
      canonical: page.path,
    },
    openGraph: {
      title,
      description: page.description,
      url: page.path,
      siteName: PRODUCT_NAME,
      type: 'website',
      locale: 'en_US',
      images: [{ url: absoluteUrl('/opengraph-image'), width: 1200, height: 630, alt: PRODUCT_NAME }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description: page.description,
      images: [absoluteUrl('/opengraph-image')],
    },
  };
}

export function findSeoPage(path: string): PublicSeoPage {
  const page = PUBLIC_SEO_PAGES.find((entry) => entry.path === path);
  if (!page) throw new Error(`Missing SEO page config for ${path}`);
  return page;
}
