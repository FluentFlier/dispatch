'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Menu, X } from 'lucide-react';
import { getFunnelCta, type FunnelState } from '@/lib/funnel-cta';
import { CTA_SIGN_IN, PRODUCT_NAME } from './brand';

const FOCUS =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-2';

const ANCHORS = [
  ['#loop', 'Loop'],
  ['#voice', 'Voice'],
  ['#different', 'Why us'],
  ['#week', 'Week'],
] as const;

export default function Nav({ funnel }: { funnel: FunnelState }) {
  const [open, setOpen] = useState(false);
  const { href: primaryHref, label: primaryLabel } = getFunnelCta(funnel);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <nav className="sticky top-0 z-50 bg-paper/75 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1100px] items-center justify-between px-5 py-4 sm:px-8">
        <Link href="/" className={`text-[17px] font-semibold text-ink ${FOCUS}`}>
          {PRODUCT_NAME.toLowerCase()}.
        </Link>

        <div className="hidden items-center gap-6 md:flex">
          {ANCHORS.map(([href, label]) => (
            <a key={href} href={href} className={`text-[14px] text-ink2 hover:text-ink ${FOCUS}`}>
              {label}
            </a>
          ))}
          <Link href="/pricing" className={`text-[14px] text-ink2 hover:text-ink ${FOCUS}`}>
            Pricing
          </Link>
          {!funnel.loggedIn && (
            <Link href="/login" className={`text-[14px] text-ink2 hover:text-ink ${FOCUS}`}>
              {CTA_SIGN_IN}
            </Link>
          )}
          <Link
            href={primaryHref}
            className={`rounded-full border border-hair2 bg-white px-4 py-2 text-[13px] font-medium text-ink ${FOCUS}`}
          >
            {primaryLabel}
          </Link>
        </div>

        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen((v) => !v)}
          className={`inline-flex h-10 w-10 items-center justify-center rounded-full border border-hair2 bg-white md:hidden ${FOCUS}`}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {open && (
        <div className="border-t border-hair px-5 py-4 md:hidden">
          <div className="flex flex-col gap-2">
            {ANCHORS.map(([href, label]) => (
              <a
                key={href}
                href={href}
                onClick={() => setOpen(false)}
                className="rounded-lg px-3 py-2.5 text-[14px] text-ink2"
              >
                {label}
              </a>
            ))}
            <Link href="/pricing" onClick={() => setOpen(false)} className="rounded-lg px-3 py-2.5 text-[14px] text-ink2">
              Pricing
            </Link>
            {!funnel.loggedIn && (
              <Link href="/login" onClick={() => setOpen(false)} className="rounded-lg px-3 py-2.5 text-[14px] text-ink2">
                {CTA_SIGN_IN}
              </Link>
            )}
            <Link
              href={primaryHref}
              onClick={() => setOpen(false)}
              className="mt-1 rounded-full bg-ink px-4 py-3 text-center text-[14px] font-medium text-paper"
            >
              {primaryLabel}
            </Link>
          </div>
        </div>
      )}
    </nav>
  );
}
