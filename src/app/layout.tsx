import type { Metadata } from 'next';
import { DM_Sans, Fraunces, Hanken_Grotesk, JetBrains_Mono } from 'next/font/google';
import { PRODUCT_NAME } from '@/lib/brand';
import { pageMetadata, findSeoPage } from '@/lib/seo';
import { ThemeProvider, themeNoFlashScript } from '@/components/theme/ThemeProvider';
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

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://contentos.us'),
  ...pageMetadata(findSeoPage('/')),
  title: {
    default: findSeoPage('/').title,
    template: `%s - ${PRODUCT_NAME}`,
  },
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
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeNoFlashScript }} />
      </head>
      <body className={hanken.className}>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
