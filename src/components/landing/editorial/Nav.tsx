'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { getFunnelCta, type FunnelState } from '@/lib/funnel-cta';
import { CTA_SIGN_IN, PRODUCT_NAME } from './brand';

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue focus-visible:ring-offset-2';

const ANCHORS = [
  ['#problem', 'Problem'],
  ['#loop', 'Loop'],
  ['#voice', 'Voice'],
  ['#week', 'Week'],
] as const;

export default function Nav({ funnel }: { funnel: FunnelState }) {
  const [open, setOpen] = useState(false);
  const { href: primaryHref, label: primaryLabel } = getFunnelCta(funnel);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <nav className="sticky top-0 z-50 border-b border-hair bg-paper/88 backdrop-blur-[14px]">
      <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-4 px-5 py-4 sm:px-10 sm:py-[18px]">
        <Link
          href="/"
          className={`flex items-center gap-[11px] ${FOCUS_RING}`}
          onClick={() => setOpen(false)}
        >
          <span className="grid h-[22px] w-[22px] place-items-center rounded-md bg-ink font-mono text-[12px] font-medium text-paper">
            /
          </span>
          <span className="font-mono text-[12.5px] font-medium tracking-[0.18em] text-ink">
            {PRODUCT_NAME.toUpperCase()}
          </span>
        </Link>

        <div className="hidden items-center gap-8 md:flex">
          {ANCHORS.map(([href, label]) => (
            <a
              key={href}
              href={href}
              className={`font-mono text-[12px] tracking-[0.04em] text-ink2 transition-colors hover:text-ink ${FOCUS_RING}`}
            >
              {label}
            </a>
          ))}
          <Link
            href="/pricing"
            className={`font-mono text-[12px] tracking-[0.04em] text-ink2 transition-colors hover:text-ink ${FOCUS_RING}`}
          >
            Pricing
          </Link>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {!funnel.loggedIn && (
            <Link
              href="/login"
              className={`hidden font-mono text-[12px] tracking-[0.04em] text-ink2 transition-colors hover:text-ink sm:inline ${FOCUS_RING}`}
            >
              {CTA_SIGN_IN}
            </Link>
          )}
          <Link
            href={primaryHref}
            className={`hidden items-center gap-2 rounded-md bg-ink px-[17px] py-[10px] text-[13.5px] font-medium text-paper transition-colors hover:bg-black sm:inline-flex ${FOCUS_RING}`}
          >
            {primaryLabel}
          </Link>
          <Link
            href={primaryHref}
            className={`inline-flex items-center rounded-md bg-ink px-3 py-2 text-[12px] font-medium text-paper sm:hidden ${FOCUS_RING}`}
          >
            {primaryLabel}
          </Link>
          <button
            type="button"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((v) => !v)}
            className={`inline-flex h-10 w-10 items-center justify-center rounded-md border border-hair2 bg-white text-ink md:hidden ${FOCUS_RING}`}
          >
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </div>

      {open && (
        <div id="mobile-nav" className="border-t border-hair bg-paper px-5 py-4 md:hidden">
          <div className="flex flex-col gap-1">
            {ANCHORS.map(([href, label]) => (
              <a
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className={`rounded-md px-3 py-3 font-mono text-[13px] tracking-[0.04em] text-ink2 transition-colors hover:bg-paper2 hover:text-ink ${FOCUS_RING}`}
              >
                {label}
              </a>
            ))}
            <Link
              href="/pricing"
              onClick={() => setOpen(false)}
              className={`rounded-md px-3 py-3 font-mono text-[13px] tracking-[0.04em] text-ink2 transition-colors hover:bg-paper2 hover:text-ink ${FOCUS_RING}`}
            >
              Pricing
            </Link>
            {!funnel.loggedIn && (
              <Link
                href="/login"
                onClick={() => setOpen(false)}
                className={`rounded-md px-3 py-3 font-mono text-[13px] tracking-[0.04em] text-ink2 transition-colors hover:bg-paper2 hover:text-ink ${FOCUS_RING}`}
              >
                {CTA_SIGN_IN}
              </Link>
            )}
            <Link
              href={primaryHref}
              onClick={() => setOpen(false)}
              className={`mt-2 inline-flex items-center justify-center rounded-md bg-ink px-4 py-3 text-[14px] font-medium text-paper ${FOCUS_RING}`}
            >
              {primaryLabel}
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}
