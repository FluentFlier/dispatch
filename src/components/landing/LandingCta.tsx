'use client';

import Link from 'next/link';
import Image from 'next/image';
import { motion, useReducedMotion } from 'motion/react';
import { PRODUCT_NAME, TRIAL_COPY } from './editorial/brand';
import { LAND_THEME } from './editorial/theme';
import LandingPlatformChips from './LandingPlatformChips';
import { getFunnelCta, type FunnelState } from '@/lib/funnel-cta';

const EASE = [0.16, 1, 0.3, 1] as const;

export default function LandingCta({ funnel }: { funnel: FunnelState }) {
  const { href: primaryHref, label: primaryLabel } = getFunnelCta(funnel);
  const reduce = useReducedMotion();

  return (
    <section className="relative scroll-mt-24 overflow-hidden">
      <Image
        src="/landing/hero-bg.png"
        alt=""
        fill
        className="pointer-events-none object-cover object-center opacity-30"
        sizes="100vw"
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-paper via-paper/85 to-paper" />

      <div className="relative mx-auto max-w-[1100px] px-5 py-14 text-center sm:px-8 sm:py-20">
        <motion.p
          initial={reduce ? false : { opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, ease: EASE }}
          className="m-0 inline-flex items-center gap-2 rounded-full border border-hair bg-white/80 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-ink2 shadow-sm backdrop-blur-sm"
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: LAND_THEME.signal }}
            aria-hidden
          />
          {PRODUCT_NAME}
        </motion.p>
        <motion.h2
          initial={reduce ? false : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.55, delay: 0.05, ease: EASE }}
          className="m-0 mt-3 text-[clamp(32px,5vw,52px)] font-semibold tracking-[-0.04em] text-ink"
        >
          Try it free.
        </motion.h2>
        <motion.p
          initial={reduce ? false : { opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.1, ease: EASE }}
          className="m-0 mt-2 text-[14px] text-ink3"
        >
          {TRIAL_COPY}
        </motion.p>

        <motion.div
          initial={reduce ? false : { opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.15, ease: EASE }}
        >
          <Link
            href={primaryHref}
            className="mt-8 inline-flex rounded-full bg-ink px-8 py-3.5 text-[15px] font-medium text-paper shadow-[0_16px_48px_-16px_rgba(23,23,23,0.5)] transition-transform hover:-translate-y-px"
          >
            {primaryLabel}
          </Link>
        </motion.div>

        <div className="m-0 mt-10 flex justify-center">
          <LandingPlatformChips size="sm" />
        </div>
      </div>
    </section>
  );
}
