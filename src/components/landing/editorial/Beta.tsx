import Link from 'next/link';
import { getFunnelCta, type FunnelState } from '@/lib/funnel-cta';
import { TRIAL_COPY } from './brand';

export default function Beta({ funnel }: { funnel: FunnelState }) {
  const { href: primaryHref, label: primaryLabel } = getFunnelCta(funnel);

  return (
    <section id="beta" className="scroll-mt-24">
      <div className="mx-auto max-w-[640px] px-5 py-16 text-center sm:px-10 sm:py-24">
        <h2 className="m-0 text-[clamp(32px,5vw,48px)] font-semibold leading-[1.02] tracking-[-0.03em] text-ink">
          Try it free for 7 days.
        </h2>
        <p className="m-0 mt-3 text-[14px] text-ink2">{TRIAL_COPY}</p>

        <div className="mt-8 flex flex-col items-center gap-3">
          <Link
            href={primaryHref}
            className="inline-flex w-full max-w-sm items-center justify-center rounded-full bg-ink py-3.5 text-[15px] font-medium text-paper shadow-[0_8px_24px_-8px_rgba(23,23,23,0.45)] transition-transform hover:-translate-y-0.5 sm:w-auto sm:px-10"
          >
            {primaryLabel}
          </Link>
          <Link href="/pricing" className="text-[14px] text-ink2 hover:text-ink">
            View pricing
          </Link>
        </div>
      </div>
    </section>
  );
}
