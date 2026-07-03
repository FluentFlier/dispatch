import Link from 'next/link';
import { getFunnelCta, type FunnelState } from '@/lib/funnel-cta';
import { TRIAL_COPY } from './brand';

export default function Beta({ funnel }: { funnel: FunnelState }) {
  const { href: primaryHref, label: primaryLabel } = getFunnelCta(funnel);

  return (
    <section id="beta" className="scroll-mt-24 border-t border-hair bg-paper2">
      <div className="mx-auto max-w-[520px] px-5 py-14 text-center sm:px-10 sm:py-20">
        <span className="font-mono text-[11.5px] tracking-[0.12em] text-flame">07 / START</span>
        <h2 className="ed-serif my-4 text-[clamp(32px,5vw,48px)] font-normal leading-[0.98] tracking-[-0.03em] text-ink">
          Try it free for 7 days.
        </h2>
        <p className="m-0 font-mono text-[12px] text-ink2">{TRIAL_COPY}</p>

        <div className="mt-8 flex flex-col gap-3">
          <Link
            href={primaryHref}
            className="inline-flex w-full items-center justify-center rounded-md bg-blue py-3.5 text-[15px] font-medium text-white hover:bg-blue-dark"
          >
            {primaryLabel}
          </Link>
          <Link href="/pricing" className="text-[13px] text-ink2 hover:text-ink">
            Pricing →
          </Link>
        </div>
      </div>
    </section>
  );
}
