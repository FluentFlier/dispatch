import type { Metadata } from 'next';
import { DM_Sans, Fraunces, Hanken_Grotesk, JetBrains_Mono } from 'next/font/google';
import { PRODUCT_NAME, SITE_TITLE } from '@/lib/brand';
import './globals.css';

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
});

const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-fraunces',
  display: 'swap',
});

const hanken = Hanken_Grotesk({
  subsets: ['latin'],
  variable: '--font-hanken',
  display: 'swap',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
});

const SITE_DESC =
  'Create in your voice, publish to LinkedIn and X, reply faster, and turn the response into what you do next.';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://contentos.us'),
  title: {
    default: SITE_TITLE,
    template: `%s — ${PRODUCT_NAME}`,
  },
  description: SITE_DESC,
  applicationName: PRODUCT_NAME,
  keywords: [
    'content creation',
    'LinkedIn publishing',
    'X publishing',
    'social media scheduling',
    'creator tools',
    'content operating system',
    'lead generation',
    'AI writing in your voice',
  ],
  category: 'technology',
  alternates: {
    canonical: './',
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESC,
    url: '/',
    siteName: PRODUCT_NAME,
    type: 'website',
    locale: 'en_US',
    images: [{ url: '/opengraph-image', width: 1200, height: 630, alt: PRODUCT_NAME }],
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESC,
    images: ['/opengraph-image'],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): JSX.Element {
  return (
    <html
      lang="en"
      className={`scroll-smooth ${dmSans.variable} ${fraunces.variable} ${hanken.variable} ${jetbrains.variable}`}
    >
      <body className={dmSans.className}>{children}</body>
    </html>
  );
}
