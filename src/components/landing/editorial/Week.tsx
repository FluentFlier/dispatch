'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import LandingSectionHeader from '../LandingSectionHeader';
import { WALK_STEPS } from './data';
import { SECTION_THEME } from './theme';

const theme = SECTION_THEME.week;

const EASE = [0.16, 1, 0.3, 1] as const;

export default function Week() {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setActive((i) => (i + 1) % WALK_STEPS.length), 3400);
    return () => clearInterval(t);
  }, [reduce]);

  const scene = WALK_STEPS[active];

  return (
    <section id="week" className="relative scroll-mt-24 overflow-hidden bg-[#0E0E10] text-paper">
      <Image
        src="/landing/ambient.png"
        alt=""
        fill
        className="pointer-events-none object-cover object-center opacity-30 mix-blend-screen"
        sizes="100vw"
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#0E0E10]/80 via-transparent to-[#0E0E10]" />
      <div className="pointer-events-none absolute -left-20 top-1/4 h-64 w-64 rounded-full bg-blue/20 blur-[100px] animate-land-drift-a" />
      <div className="pointer-events-none absolute -right-16 bottom-1/4 h-56 w-56 rounded-full bg-teal/15 blur-[90px] animate-land-drift-b" />

      <div className="relative mx-auto max-w-[1100px] px-5 py-12 sm:px-8 sm:py-14">
        <LandingSectionHeader
          tag={theme.tag}
          title="One week in the loop."
          subtitle="From calendar event to queued posts."
          accent={theme.accent}
          variant="dark"
        />

        <div className="mt-10 grid grid-cols-1 gap-8 lg:grid-cols-[220px_1fr]">
          <div className="flex flex-col">
            {WALK_STEPS.map((step, i) => {
              const on = i === active;
              return (
                <button
                  key={step.num}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setActive(i)}
                  className={`grid w-full grid-cols-[64px_1fr] items-center gap-2 py-2.5 text-left transition-colors duration-300 ${
                    i === 0 ? '' : 'border-t border-paper/10'
                  }`}
                >
                  <span
                    className="font-mono text-[10px] transition-colors duration-300"
                    style={{ color: on ? step.accent : 'rgba(244,242,236,0.4)' }}
                  >
                    {step.num}
                  </span>
                  <span
                    className="text-[13px] transition-all duration-300"
                    style={{
                      fontWeight: on ? 600 : 400,
                      color: on ? '#FBFAF7' : 'rgba(244,242,236,0.55)',
                    }}
                  >
                    {step.label}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="relative min-h-[180px] border-t border-paper/15 pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={scene.num}
                initial={reduce ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduce ? undefined : { opacity: 0, y: -8 }}
                transition={{ duration: 0.4, ease: EASE }}
              >
                <span
                  className="inline-block rounded border px-2 py-0.5 font-mono text-[10px] tracking-wide"
                  style={{ color: scene.accent, borderColor: scene.accent }}
                >
                  {scene.tag}
                </span>
                <h3 className="m-0 my-4 max-w-[22ch] text-[clamp(22px,2.8vw,32px)] font-semibold leading-tight text-paper">
                  {scene.line}
                </h3>
                <span className="font-mono text-[11px]" style={{ color: scene.accent }}>
                  {scene.metric}
                </span>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}
