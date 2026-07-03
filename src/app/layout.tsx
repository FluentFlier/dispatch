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
  'The private content command center for creators who ship. Write in your voice, schedule everywhere, reply faster, and learn what compounds.';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
  title: SITE_TITLE,
  description: SITE_DESC,
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESC,
    url: '/',
    siteName: PRODUCT_NAME,
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: PRODUCT_NAME }],
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESC,
    images: ['/og.png'],
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
