import type { Metadata } from 'next';
import { PRODUCT_NAME } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Pricing',
  description: `Simple plans for creators at every stage. Start a free ${PRODUCT_NAME} trial - publish to LinkedIn and X, reply faster, and turn engagement into leads.`,
  alternates: {
    canonical: '/pricing',
  },
};

export default function PricingLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return <>{children}</>;
}
