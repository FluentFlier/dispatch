'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useReducedMotion } from 'motion/react';
import { Badge, Button } from '@/components/ui';
import StatusBadge from '@/components/ui/StatusBadge';

const COMPOSER_TEXT = 'I stopped trying to be consistent. I built a system instead.';

/**
 * Hero with the live "cockpit" composer card. The composer line types itself once at
 * ~34ms/char and the Voice QA meter animates 0→94% shortly after mount. Both effects
 * collapse to their final state when the user prefers reduced motion. Typing writes to
 * a ref's textContent rather than React state so it never re-renders the whole tree.
 */
export default function Hero({ loggedIn }: { loggedIn: boolean }) {
  const reduce = useReducedMotion();
  const composerRef = useRef<HTMLSpanElement>(null);
  const [voice, setVoice] = useState(0);

  useEffect(() => {
    const node = composerRef.current;
    if (reduce) {
      if (node) node.textContent = COMPOSER_TEXT;
      setVoice(94);
      return;
    }

    let i = 0;
    const typeT = setInterval(() => {
      i++;
      if (composerRef.current) composerRef.current.textContent = COMPOSER_TEXT.slice(0, i);
      if (i >= COMPOSER_TEXT.length) clearInterval(typeT);
    }, 34);
    const voiceT = setTimeout(() => setVoice(94), 650);

    return () => {
      clearInterval(typeT);
      clearTimeout(voiceT);
    };
  }, [reduce]);

  const primaryHref = loggedIn ? '/dashboard' : '#beta';

  return (
    <header className="mx-auto max-w-[1180px] px-10">
      {/* eyebrow rule row */}
      <div className="flex items-center justify-between border-b border-hair py-[22px]">
        <span className="font-mono text-[11.5px] tracking-[0.14em] text-ink3">
          01 — THE SELF-IMPROVING CONTENT COMMAND CENTER
        </span>
        <span className="hidden font-mono text-[11.5px] tracking-[0.14em] text-ink3 sm:block">
          EST. FOR CREATORS WHO SHIP
        </span>
      </div>

      <div className="pb-[30px] pt-16">
        <h1 className="ed-serif m-0 max-w-[14ch] text-[clamp(48px,8vw,116px)] font-normal leading-[0.92] tracking-[-0.035em] text-ink">
          Your private content engine.
        </h1>
      </div>

      <div className="grid grid-cols-1 items-end gap-14 border-b border-hair pb-14 lg:grid-cols-[1fr_1.15fr]">
        <div>
          <div className="mb-6 h-[2px] w-12 bg-flame" />
          <p className="m-0 mb-7 max-w-[42ch] text-[19px] leading-[1.5] text-ink2">
            It learns every time you publish. Content OS turns your calendar, stories,
            drafts, posts, replies, and analytics into one closed-loop workspace — across
            X, LinkedIn, Instagram, and Threads.
          </p>
          <div className="flex flex-wrap items-center gap-[13px]">
            <Link
              href={primaryHref}
              className="inline-flex items-center gap-[9px] rounded-md bg-blue px-[22px] py-[13px] text-[15px] font-medium text-white shadow-[0_1px_2px_rgba(23,23,23,0.08)] transition-colors hover:bg-blue-dark"
            >
              {loggedIn ? 'Open Content OS' : 'Join private beta'}
            </Link>
            <a
              href="#week"
              className="inline-flex items-center gap-[9px] rounded-md border border-hair2 bg-white px-5 py-[13px] text-[15px] font-medium text-ink transition-colors hover:bg-paper2"
            >
              Watch 90-sec demo →
            </a>
          </div>
        </div>

        {/* LIGHT PRODUCT COCKPIT */}
        <div className="relative">
          <span className="absolute -top-[26px] left-0 font-mono text-[11px] tracking-[0.1em] text-ink3">
            ↳ LIVE PRODUCT SURFACE
          </span>
          <div className="overflow-hidden rounded-[14px] border border-hair bg-white shadow-[0_24px_60px_-32px_rgba(23,23,23,0.35)]">
            <div className="flex items-center justify-between border-b border-hair bg-paper px-4 py-[13px]">
              <span className="font-mono text-[10.5px] tracking-[0.12em] text-ink3">
                CONTENT OS · COMPOSER
              </span>
              <span className="inline-flex items-center gap-[6px]">
                <span className="h-[6px] w-[6px] rounded-full bg-teal animate-ed-pulse" />
                <span className="font-mono text-[10.5px] text-teal">Creator Brain active</span>
              </span>
            </div>

            <div className="p-4">
              <div className="mb-3 flex flex-wrap gap-[7px]">
                <span className="rounded-[5px] bg-paper2 px-2 py-1 font-mono text-[10px] text-ink2">
                  CAL · Podcast w/ YC founder · tomorrow
                </span>
                <span className="rounded-[5px] bg-paper2 px-2 py-1 font-mono text-[10px] text-ink2">
                  MEM · “consistency”
                </span>
              </div>

              <div className="mb-[13px] min-h-[74px] rounded-[10px] border border-hair p-[14px]">
                <div className="mb-[9px] flex items-center justify-between">
                  <span className="font-mono text-[9.5px] tracking-[0.06em] text-ink3">
                    DRAFT · HOOK
                  </span>
                  <div className="flex gap-[5px]">
                    <Badge className="bg-bg-tertiary text-text-tertiary">X</Badge>
                    <Badge className="bg-bg-tertiary text-text-tertiary">LinkedIn</Badge>
                    <Badge className="bg-bg-tertiary text-text-tertiary">Threads</Badge>
                  </div>
                </div>
                <p className="ed-serif m-0 text-[17px] leading-[1.34] text-ink">
                  <span ref={composerRef} />
                  <span className="ml-px inline-block h-4 w-[2px] -translate-y-[2px] bg-flame align-middle animate-ed-blink" />
                </p>
              </div>

              <div className="mb-[13px] grid grid-cols-2 gap-[9px]">
                <div className="rounded-[9px] border border-hair px-[11px] py-[10px]">
                  <div className="mb-[7px] flex items-center justify-between">
                    <span className="font-mono text-[9px] tracking-[0.04em] text-ink3">
                      VOICE QA
                    </span>
                    <span className="font-mono text-[13px] font-medium text-teal">{voice}%</span>
                  </div>
                  <div className="h-[5px] overflow-hidden rounded-full bg-paper2">
                    <div
                      className="h-full rounded-full bg-teal transition-[width] duration-[1500ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
                      style={{ width: `${voice}%` }}
                    />
                  </div>
                </div>
                <div className="rounded-[9px] border border-hair px-[11px] py-[10px]">
                  <div className="mb-[7px] flex items-center justify-between">
                    <span className="font-mono text-[9px] tracking-[0.04em] text-ink3">HOOK</span>
                    <span className="font-mono text-[13px] font-medium text-flame">87</span>
                  </div>
                  <div className="flex gap-[3px]">
                    <div className="h-[5px] flex-1 rounded-[9px] bg-flame" />
                    <div className="h-[5px] flex-1 rounded-[9px] bg-flame" />
                    <div className="h-[5px] flex-1 rounded-[9px] bg-flame opacity-80" />
                    <div className="h-[5px] flex-1 rounded-[9px] bg-paper2" />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-hair pt-3">
                <div className="flex items-center gap-2">
                  <StatusBadge status="scripted" />
                  <span className="font-mono text-[10.5px] text-ink3">Generic-AI risk · low</span>
                </div>
                <Button variant="primary" size="sm">
                  Schedule · Tue 9:20
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* platform strip */}
      <div className="flex flex-wrap items-center gap-x-10 gap-y-2 py-5 font-mono text-[12px] tracking-[0.06em] text-ink3">
        <span>PUBLISHES NATIVELY TO →</span>
        <span className="text-ink2">X / Twitter</span>
        <span className="text-ink2">LinkedIn</span>
        <span className="text-ink2">Instagram</span>
        <span className="text-ink2">Threads</span>
      </div>
    </header>
  );
}
