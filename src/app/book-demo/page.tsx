import Link from 'next/link';
import type { Metadata } from 'next';
import CalendlyEmbed from '@/components/book-demo/CalendlyEmbed';
import { PRODUCT_NAME } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Book a demo',
  description: `Schedule a founder-led walkthrough of ${PRODUCT_NAME}.`,
  alternates: { canonical: '/book-demo' },
};

/**
 * Public demo booking page - no auth required so GTM links work from ads and email.
 */
export default function BookDemoPage(): JSX.Element {
  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <div className="mx-auto max-w-4xl px-5 py-12 sm:py-16">
        <Link href="/" className="text-[12px] text-accent-primary hover:text-accent-dark">
          ← {PRODUCT_NAME}
        </Link>

        <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_1.2fr] lg:items-start">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
              Founder walkthrough
            </p>
            <h1 className="mt-3 font-serif text-[clamp(28px,4vw,40px)] font-normal tracking-[-0.03em]">
              See {PRODUCT_NAME} in action
            </h1>
            <p className="mt-4 text-[15px] leading-7 text-text-secondary">
              20 minutes on voice-aware drafting, scheduling, engagement replies, and the intelligence loop
              that makes your next post better than the last.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/login" className="btn-primary inline-flex justify-center">
                Start free trial
              </Link>
              <Link
                href="/pricing"
                className="inline-flex justify-center rounded-md border border-border px-5 py-2.5 text-sm font-medium text-text-primary hover:border-border-hover"
              >
                View pricing
              </Link>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-bg-secondary p-4 shadow-card">
            <CalendlyEmbed className="calendly-inline-widget min-h-[680px] w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
