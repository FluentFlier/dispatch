'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import { getFunnelCta, type FunnelState } from '@/lib/funnel-cta';
import { HERO_LINE_1, HERO_LINE_2, HERO_SUBCOPY, TRIAL_COPY } from './brand';
import LandingPlatformChips from '../LandingPlatformChips';
import ProductMockup from '../ProductMockup';

const EASE = [0.16, 1, 0.3, 1] as const;

export default function Hero({ funnel }: { funnel: FunnelState }) {
  const { href: primaryHref, label: primaryLabel } = getFunnelCta(funnel);
  const reduce = useReducedMotion();
  const { scrollY } = useScroll();
  const copyY = useTransform(scrollY, [0, 420], [0, reduce ? 0 : 36]);
  const mockY = useTransform(scrollY, [0, 420], [0, reduce ? 0 : -20]);
  const heroOpacity = useTransform(scrollY, [0, 320], [1, reduce ? 1 : 0.88]);

  return (
    <motion.header
      style={{ opacity: heroOpacity }}
      className="relative mx-auto flex min-h-[min(92svh,860px)] max-w-[1160px] items-center overflow-visible px-5 pb-14 pt-8 sm:px-8 sm:pb-16 sm:pt-12"
    >
      <div className="grid w-full grid-cols-1 items-center gap-10 lg:grid-cols-[minmax(0,0.84fr)_minmax(0,1.16fr)] lg:items-center lg:gap-6 xl:gap-10">
        <motion.div className="max-w-[36ch] lg:pb-6 lg:pt-2" style={{ y: copyY }}>
          <motion.h1
            initial={reduce ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, ease: EASE }}
            className="m-0 text-[clamp(42px,6.8vw,72px)] font-semibold leading-[0.98] tracking-[-0.045em] text-ink"
          >
            {HERO_LINE_1}
            <span className="mt-1 block text-blue">{HERO_LINE_2}</span>
          </motion.h1>

          <motion.div
            initial={reduce ? false : { scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 0.55, delay: 0.08, ease: EASE }}
            className="mt-5 h-px w-16 origin-left bg-gradient-to-r from-blue/70 via-teal/50 to-transparent"
            aria-hidden
          />

          <motion.p
            initial={reduce ? false : { opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.12, ease: EASE }}
            className="m-0 mt-5 text-[17px] leading-relaxed text-ink2"
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
              className="inline-flex items-center gap-2 rounded-full bg-ink px-6 py-3.5 text-[15px] font-medium text-paper shadow-[0_12px_40px_-12px_rgba(23,23,23,0.45)] transition-transform hover:-translate-y-px"
            >
              {primaryLabel}
              <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="#loop"
              className="inline-flex items-center rounded-full border border-hair2 bg-white/75 px-5 py-3.5 text-[15px] font-medium text-ink backdrop-blur-md transition-all hover:border-blue/25 hover:bg-white/90"
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
        </motion.div>

        <motion.div
          initial={reduce ? false : { opacity: 0, y: 28, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.75, delay: 0.15, ease: EASE }}
          style={{ y: mockY }}
          className={`relative lg:-mr-4 lg:translate-x-3 xl:-mr-8 xl:translate-x-6 ${reduce ? '' : 'animate-land-float'}`}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-8 rounded-[2.5rem] bg-gradient-to-br from-blue/12 via-transparent to-teal/10 blur-2xl"
          />
          <ProductMockup className="mx-auto w-full max-w-[500px] lg:max-w-[560px] lg:ml-auto" />
        </motion.div>
      </div>

      {!reduce && (
        <motion.a
          href="#loop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.9, duration: 0.5 }}
          className="absolute bottom-6 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-ink3 transition-colors hover:text-ink2"
        >
          <span className="h-8 w-px bg-gradient-to-b from-transparent via-ink3/50 to-ink3/20" />
          Scroll
        </motion.a>
      )}
    </motion.header>
  );
}
