import Link from 'next/link';
import { CTA_OPEN_APP, CTA_SIGN_IN, CTA_START_TRIAL, TRIAL_COPY } from './brand';

interface Props {
  loggedIn: boolean;
  onboardingComplete: boolean;
}

export default function Beta({ loggedIn, onboardingComplete }: Props) {
  const primaryHref = !loggedIn
    ? '/login'
    : onboardingComplete
      ? '/dashboard'
      : '/get-started';
  const primaryLabel = !loggedIn
    ? CTA_START_TRIAL
    : onboardingComplete
      ? CTA_OPEN_APP
      : CTA_START_TRIAL;

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
          {!loggedIn && (
            <Link
              href="/login"
              className="inline-flex w-full items-center justify-center rounded-md border border-hair2 bg-white py-3.5 text-[15px] font-medium text-ink hover:bg-paper2"
            >
              {CTA_SIGN_IN}
            </Link>
          )}
          <Link href="/pricing" className="text-[13px] text-ink2 hover:text-ink">
            Pricing →
          </Link>
        </div>
      </div>
    </section>
  );
}
