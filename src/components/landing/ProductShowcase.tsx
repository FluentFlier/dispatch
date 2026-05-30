'use client';

import { useRef } from 'react';
import Image from 'next/image';
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import { Reveal } from './primitives';
import SectionAtmosphere from './SectionAtmosphere';

/**
 * Floating product mockup, the Cluely-style "here is the real thing" moment.
 * The frame enters with a subtle 3D tilt that flattens and lifts on scroll,
 * over a coral/cyan atmosphere. Honors prefers-reduced-motion.
 */
export default function ProductShowcase() {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end center'],
  });
  const y = useTransform(scrollYProgress, [0, 1], reduced ? [0, 0] : [70, -30]);
  const scale = useTransform(scrollYProgress, [0, 0.7], reduced ? [1, 1] : [0.93, 1]);
  const rotateX = useTransform(scrollYProgress, [0, 0.7], reduced ? [0, 0] : [9, 0]);

  return (
    <section className="relative scroll-mt-24 py-24 sm:py-28">
      <SectionAtmosphere tone="coral" accent="cyan" position="center" />
      <div className="relative z-10 mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal className="mx-auto max-w-2xl text-center">
          <p className="os-mono text-[11px] uppercase tracking-[0.2em] text-os-muted">
            The whole loop, one screen
          </p>
          <h2 className="os-serif mt-3 text-[clamp(30px,4.4vw,52px)] font-light leading-[1.02] tracking-[-0.025em] text-os-text">
            Your media desk <span className="os-shimmer-text italic">at 1am.</span>
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-[16px] leading-7 text-os-soft">
            Research, draft in your voice, queue, reply, and see what compounded,
            in one calm command center. Not twelve tabs.
          </p>
        </Reveal>

        <div ref={ref} className="relative mt-12 sm:mt-16" style={{ perspective: '1600px' }}>
          <div
            className="pointer-events-none absolute left-1/2 top-6 h-[60%] w-[80%] -translate-x-1/2 rounded-full blur-[120px]"
            style={{ background: 'radial-gradient(circle, rgba(255,107,74,0.26), transparent 70%)' }}
            aria-hidden
          />
          <motion.div
            style={{ y, scale, rotateX, transformStyle: 'preserve-3d' }}
            className="relative mx-auto max-w-5xl"
          >
            <div className="overflow-hidden rounded-[18px] border border-os-border-strong bg-os-surface-strong shadow-[0_50px_120px_-30px_rgba(0,0,0,0.85)] ring-1 ring-white/[0.06]">
              <Image
                src="/images/showcase-dashboard.png"
                alt="Content OS command center: composer, queue, voice match, and what compounded"
                width={1320}
                height={860}
                sizes="(max-width: 1024px) 100vw, 1024px"
                className="h-auto w-full"
              />
            </div>
            {/* floating accent chip for product-y depth */}
            <div className="absolute -right-3 -top-4 hidden rounded-xl border border-os-border bg-os-bg/90 px-3.5 py-2 shadow-glass backdrop-blur sm:block">
              <p className="os-mono text-[9px] uppercase tracking-[0.14em] text-os-muted">trained voice</p>
              <p className="os-mono text-[15px] font-semibold leading-none text-os-cyan">94%</p>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
