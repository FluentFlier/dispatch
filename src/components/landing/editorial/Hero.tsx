'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useReducedMotion } from 'motion/react';
import { Badge, Button } from '@/components/ui';
import StatusBadge from '@/components/ui/StatusBadge';
import {
  CTA_OPEN_APP,
  CTA_START_TRIAL,
  HERO_HEADLINE,
  HERO_SUBCOPY,
  PLATFORMS,
  PRODUCT_NAME,
  TRIAL_COPY,
} from './brand';

const COMPOSER_TEXT = 'I stopped trying to be consistent. I built a system instead.';

/**
 * Hero with a live composer card. The draft line types once; Voice QA animates to 94%.
 * Both collapse to final state when the user prefers reduced motion.
 */
export default function Hero({
  loggedIn,
  onboardingComplete,
}: {
  loggedIn: boolean;
  onboardingComplete: boolean;
}) {
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
    <header className="mx-auto max-w-[1180px] px-5 sm:px-10">
      <div className="flex items-center justify-between border-b border-hair py-4 sm:py-5">
        <span className="font-mono text-[11px] tracking-[0.14em] text-ink3">
          01 — {PRODUCT_NAME.toUpperCase()}
        </span>
      </div>

      <div className="pb-6 pt-12 sm:pb-[30px] sm:pt-16">
        <h1 className="ed-serif m-0 max-w-[14ch] text-[clamp(42px,8vw,116px)] font-normal leading-[0.92] tracking-[-0.035em] text-ink">
          {HERO_HEADLINE}
        </h1>
      </div>

      <div className="grid grid-cols-1 items-end gap-10 border-b border-hair pb-10 sm:gap-14 sm:pb-14 lg:grid-cols-[1fr_1.15fr]">
        <div>
          <div className="mb-6 h-[2px] w-12 bg-flame" />
          <p className="m-0 mb-6 max-w-[36ch] text-[17px] leading-[1.45] text-ink2">
            {HERO_SUBCOPY}{' '}
            <span className="text-teal">{TRIAL_COPY}</span>
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href={primaryHref}
              className="inline-flex items-center gap-2 rounded-md bg-blue px-5 py-3 text-[15px] font-medium text-white shadow-[0_1px_2px_rgba(23,23,23,0.08)] transition-colors hover:bg-blue-dark sm:px-[22px] sm:py-[13px]"
            >
              {primaryLabel}
            </Link>
            <a
              href="#week"
              className="inline-flex items-center gap-2 rounded-md border border-hair2 bg-white px-4 py-3 text-[15px] font-medium text-ink transition-colors hover:bg-paper2 sm:px-5 sm:py-[13px]"
            >
              See the loop →
            </a>
          </div>
        </div>

        <div className="relative">
          <span className="absolute -top-5 left-0 font-mono text-[10px] tracking-[0.1em] text-ink3">
            PREVIEW
          </span>
          <div className="overflow-hidden rounded-[14px] border border-hair bg-white shadow-[0_24px_60px_-32px_rgba(23,23,23,0.35)]">
            <div className="flex items-center justify-between border-b border-hair bg-paper px-4 py-3 sm:py-[13px]">
              <span className="font-mono text-[10.5px] tracking-[0.12em] text-ink3">
                {PRODUCT_NAME.toUpperCase()} · COMPOSER
              </span>
              <span className="inline-flex items-center gap-[6px]">
                <span className="h-[6px] w-[6px] rounded-full bg-teal animate-ed-pulse" />
                <span className="font-mono text-[10.5px] text-teal">Brain on</span>
              </span>
            </div>

            <div className="p-4">
              <div className="mb-3 flex flex-wrap gap-[7px]">
                <span className="rounded-[5px] bg-paper2 px-2 py-1 font-mono text-[10px] text-ink2">
                  CAL · Podcast tomorrow
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

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hair pt-3">
                <div className="flex items-center gap-2">
                  <StatusBadge status="scripted" />
                  <span className="font-mono text-[10.5px] text-ink3">AI risk · low</span>
                </div>
                <Button variant="primary" size="sm">
                  Schedule · Tue 9:20
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 py-5 font-mono text-[11px] tracking-[0.06em] text-ink3 sm:gap-x-10 sm:text-[12px]">
        <span>→</span>
        {PLATFORMS.map((platform) => (
          <span key={platform} className="text-ink2">
            {platform}
          </span>
        ))}
      </div>
    </header>
  );
}
