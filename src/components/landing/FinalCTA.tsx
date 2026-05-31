'use client';

import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import Aurora from './Aurora';
import { Magnetic, Reveal } from './primitives';

export default function FinalCTA({ loggedIn }: { loggedIn: boolean }) {
  return (
    <section className="relative overflow-hidden py-28">
      <Aurora intensity="calm" />
      <div className="relative z-10 mx-auto max-w-3xl px-5 text-center sm:px-8">
        <Reveal>
          <p className="os-mono text-[11px] uppercase tracking-[0.22em] text-os-muted">
            Your content loop is waiting
          </p>
          <h2 className="os-serif mt-4 text-[clamp(38px,7vw,80px)] font-light leading-[0.98] tracking-[-0.03em] text-os-text">
            Build your <span className="os-shimmer-text italic">content loop.</span>
          </h2>
          <p className="mx-auto mt-5 max-w-md text-[16px] leading-7 text-os-soft">
            Free to start. Train your voice in under a minute and watch the whole
            week start moving on its own.
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Magnetic>
              <Link
                href={loggedIn ? '/dashboard' : '/login'}
                className="group relative inline-flex items-center gap-2 overflow-hidden rounded-full bg-os-coral px-7 py-4 text-[15px] font-semibold text-os-bg shadow-[0_18px_50px_-12px_rgba(255,107,74,0.6)]"
              >
                <span
                  className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/45 to-transparent transition-transform duration-700 group-hover:translate-x-full"
                  aria-hidden
                />
                {loggedIn ? 'Open workspace' : 'Start building'}
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </Magnetic>
            <Link
              href="/pricing"
              className="inline-flex items-center rounded-full border border-os-border-strong px-7 py-4 text-[15px] font-medium text-os-text transition-colors hover:bg-os-surface"
            >
              See pricing
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
