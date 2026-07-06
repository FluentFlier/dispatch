import Link from 'next/link';
import type { Metadata } from 'next';
import { PRODUCT_NAME } from '@/lib/brand';

export const metadata: Metadata = {
  title: `Terms of Service — ${PRODUCT_NAME}`,
  description: `Terms of service for ${PRODUCT_NAME}.`,
};

export default function TermsPage(): JSX.Element {
  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <div className="mx-auto max-w-3xl px-5 py-16">
        <Link href="/" className="text-[12px] text-accent-primary hover:text-accent-dark">
          ← {PRODUCT_NAME}
        </Link>
        <h1 className="mt-8 font-serif text-[32px] font-normal tracking-[-0.025em]">Terms of Service</h1>
        <p className="mt-2 text-sm text-text-secondary">Last updated: July 3, 2026</p>

        <div className="mt-10 space-y-6 text-[15px] leading-7 text-text-secondary">
          <p>
            By using {PRODUCT_NAME}, you agree to use the service lawfully and not to misuse AI-generated
            content, automation, or connected social accounts. You retain ownership of your content; you grant
            us a limited license to process it so we can provide drafting, scheduling, and analytics features.
          </p>
          <p>
            Trials and paid plans are billed according to the plan shown at checkout. You may cancel anytime;
            access continues through the end of the billing period unless otherwise stated.
          </p>
          <p>
            The service is provided &ldquo;as is.&rdquo; We do not guarantee specific reach, revenue, or
            platform API availability. Connected third-party services (LinkedIn, X, Google, etc.) remain subject
            to their own terms.
          </p>
          <p>
            Questions: contact the team through your account settings or the email on your invoice.
          </p>
        </div>
      </div>
    </div>
  );
}
