'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { getFunnelCta, type FunnelState } from '@/lib/funnel-cta';
import { HERO_LINE_1, HERO_LINE_2, HERO_SUBCOPY, TRIAL_COPY } from './brand';
import LandingPlatformChips from '../LandingPlatformChips';
import ProductMockup from '../ProductMockup';

const EASE = [0.16, 1, 0.3, 1] as const;

export default function Hero({ funnel }: { funnel: FunnelState }) {
  const { href: primaryHref, label: primaryLabel } = getFunnelCta(funnel);
  const reduce = useReducedMotion();

  return (
    <header className="relative mx-auto max-w-[1100px] px-5 pb-14 pt-10 sm:px-8 sm:pb-16 sm:pt-14">
      <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-[1fr_1fr] lg:gap-10">
        <div className="max-w-md">
          <motion.h1
            initial={reduce ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, ease: EASE }}
            className="m-0 text-[clamp(40px,6.5vw,68px)] font-semibold leading-[1.0] tracking-[-0.04em] text-ink"
          >
            {HERO_LINE_1}
            <span className="mt-1 block text-blue">{HERO_LINE_2}</span>
          </motion.h1>

          <motion.p
            initial={reduce ? false : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.12, ease: EASE }}
            className="m-0 mt-5 text-[16px] leading-relaxed text-ink2"
          >
            {HERO_SUBCOPY}
          </motion.p>

          <motion.div
            initial={reduce ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2, ease: EASE }}
            className="mt-8 flex flex-wrap items-center gap-3"
          >
            <Link
              href={primaryHref}
              className="inline-flex items-center gap-2 rounded-full bg-ink px-6 py-3 text-[15px] font-medium text-paper shadow-[0_12px_40px_-12px_rgba(23,23,23,0.45)] transition-transform hover:-translate-y-px"
            >
              {primaryLabel}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="#loop"
              className="inline-flex items-center rounded-full border border-hair2 bg-white/90 px-5 py-3 text-[15px] font-medium text-ink backdrop-blur-sm transition-all hover:border-blue/25 hover:bg-white"
            >
              See the loop
            </a>
          </motion.div>

          <motion.p
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.28, ease: EASE }}
            className="m-0 mt-3 text-[13px] text-ink3"
          >
            {TRIAL_COPY}
          </motion.p>
          <motion.div
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.34, ease: EASE }}
            className="m-0 mt-6"
          >
            <LandingPlatformChips size="sm" />
          </motion.div>
        </div>

        <motion.div
          initial={reduce ? false : { opacity: 0, y: 28, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.75, delay: 0.15, ease: EASE }}
          className={reduce ? '' : 'animate-land-float'}
        >
          <ProductMockup />
        </motion.div>
      </div>
    </header>
  );
}
