import Link from 'next/link';
import type { Metadata } from 'next';
import { PRODUCT_NAME } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: `Privacy policy for ${PRODUCT_NAME}.`,
  alternates: { canonical: '/privacy' },
};

export default function PrivacyPage(): JSX.Element {
  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <div className="mx-auto max-w-3xl px-5 py-16">
        <Link href="/" className="text-[12px] text-accent-primary hover:text-accent-dark">
          ← {PRODUCT_NAME}
        </Link>
        <h1 className="mt-8 font-serif text-[32px] font-normal tracking-[-0.025em]">Privacy Policy</h1>
        <p className="mt-2 text-sm text-text-secondary">Last updated: July 3, 2026</p>

        <div className="mt-10 space-y-6 text-[15px] leading-7 text-text-secondary">
          <p>
            {PRODUCT_NAME} collects account information (email, profile details), content you create or import,
            connected social account metadata, and usage data needed to operate drafting, scheduling, and
            analytics features.
          </p>
          <p>
            We use this data to personalize voice models, run generation, sync engagement, and improve product
            reliability. We do not sell your personal data. AI providers and infrastructure vendors process
            data only as needed to deliver the service.
          </p>
          <p>
            You may disconnect social accounts, export drafts from your library, and request account deletion
            by contacting support. OAuth tokens are encrypted at rest where configured.
          </p>
          <p>
            We may update this policy as features evolve. Continued use after updates constitutes acceptance of
            the revised policy.
          </p>
        </div>
      </div>
    </div>
  );
}
