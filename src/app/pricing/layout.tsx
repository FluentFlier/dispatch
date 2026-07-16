import type { Metadata } from 'next';
import { findSeoPage, pageMetadata } from '@/lib/seo';

export const metadata: Metadata = pageMetadata(findSeoPage('/pricing'));

export default function PricingLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return <>{children}</>;
}
