import type { Metadata } from 'next';
import { DM_Sans, Fraunces, Hanken_Grotesk, JetBrains_Mono } from 'next/font/google';
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

const SITE_TITLE = 'Content OS: Your content engine, trained on you';
const SITE_DESC =
  'The content command center for creators and founders. Research what is moving, write in your voice, schedule everywhere, reply faster, and learn what compounds.';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
  title: SITE_TITLE,
  description: SITE_DESC,
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESC,
    url: '/',
    siteName: 'Content OS',
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Content OS' }],
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
