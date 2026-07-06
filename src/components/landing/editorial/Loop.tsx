'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import LandingSectionHeader from '../LandingSectionHeader';
import LandingGlowOrb from '../LandingGlowOrb';
import LandingLoopDiagram from '../LandingLoopDiagram';
import { LOOP_STEPS } from './data';
import { SECTION_THEME } from './theme';

const theme = SECTION_THEME.loop;
const EASE = [0.16, 1, 0.3, 1] as const;

/** Five-step product loop. Auto-advances until clicked. */
export default function Loop() {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  const pinned = useRef(false);

  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => {
      if (pinned.current) return;
      setActive((i) => (i + 1) % LOOP_STEPS.length);
    }, 3200);
    return () => clearInterval(t);
  }, [reduce]);

  function pin(i: number) {
    pinned.current = true;
    setActive(i);
  }

  const activeStep = LOOP_STEPS[active];

  return (
    <section id="loop" className="relative scroll-mt-24 overflow-hidden">
      <LandingGlowOrb tone={theme.glow} position="left" />
      <div className="relative mx-auto max-w-[1100px] px-5 py-16 sm:px-8 sm:py-20">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[1fr_auto] lg:items-start">
          <LandingSectionHeader
            tag={theme.tag}
            title="Signal → ship → learn."
            subtitle="Five steps. One compounding loop."
            accent={theme.accent}
          />
          <LandingLoopDiagram className="mx-auto lg:mt-2" />
        </div>

        <div className="mt-8 overflow-hidden rounded-2xl border border-hair bg-white/80 shadow-[0_20px_50px_-30px_rgba(23,23,23,0.2)] backdrop-blur-sm">
          <div
            className="h-1 transition-colors duration-500"
            style={{ backgroundColor: activeStep.accent }}
            aria-hidden
          />
          {LOOP_STEPS.map((step, i) => {
            const on = i === active;
            return (
              <div key={step.num} className="border-b border-hair last:border-b-0">
                <button
                  type="button"
                  aria-expanded={on}
                  onClick={() => pin(i)}
                  className={`w-full text-left transition-colors duration-300 ${on ? 'bg-paper2/60' : 'hover:bg-paper2/30'}`}
                >
                  <div className="grid grid-cols-[4px_48px_1fr] items-center gap-4 px-0 py-0 sm:grid-cols-[4px_56px_140px_1fr]">
                    <span
                      className="h-full min-h-[56px] transition-colors duration-300"
                      style={{ backgroundColor: on ? step.accent : 'transparent' }}
                      aria-hidden
                    />
                    <span
                      className="font-mono text-[12px] transition-colors duration-300 pl-2 sm:pl-0"
                      style={{ color: on ? step.accent : '#908D87' }}
                    >
                      {step.num}
                    </span>
                    <span className="text-[17px] font-semibold text-ink">{step.label}</span>
                    <span
                      className={`pr-4 text-[14px] text-ink2 transition-opacity duration-300 ${on ? 'block opacity-100' : 'hidden sm:block sm:opacity-50'}`}
                    >
                      {step.lede}
                    </span>
                  </div>
                </button>
                <AnimatePresence initial={false}>
                  {on && (
                    <motion.div
                      initial={reduce ? false : { height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={reduce ? undefined : { height: 0, opacity: 0 }}
                      transition={{ duration: 0.35, ease: EASE }}
                      className="overflow-hidden"
                    >
                      <div
                        className="border-t border-hair bg-white px-4 py-3 sm:pl-[76px]"
                        style={{ borderLeftWidth: 4, borderLeftColor: step.accent }}
                      >
                        <span className="font-mono text-[10px] uppercase tracking-wide text-ink3">
                          {step.exLabel}
                        </span>
                        <p className="m-0 mt-1 text-[14px] text-ink">{step.ex}</p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
