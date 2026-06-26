'use client';

import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { LOOP_STEPS } from './data';

/**
 * "The Loop" — an accordion of the five publishing stages. It auto-advances the active
 * row every 3s until the user clicks a row, which pins that row and halts autoplay.
 * The active row gets a white background, accent-colored number/mark, and reveals a
 * detail block under a per-step accent left-border.
 */
export default function Loop() {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  const pinned = useRef(false);

  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => {
      if (pinned.current) return;
      setActive((i) => (i + 1) % LOOP_STEPS.length);
    }, 3000);
    return () => clearInterval(t);
  }, [reduce]);

  function pin(i: number) {
    pinned.current = true;
    setActive(i);
  }

  return (
    <section id="loop" className="mx-auto max-w-[1180px] border-t border-hair px-10 pb-10 pt-24">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-6">
        <div>
          <span className="font-mono text-[11.5px] tracking-[0.12em] text-flame">
            03 / THE ENGINE
          </span>
          <h2 className="ed-serif mt-[18px] text-[clamp(32px,4.4vw,58px)] font-normal leading-[0.98] tracking-[-0.03em] text-ink">
            A closed loop for
            <br />
            creators who ship.
          </h2>
        </div>
        <p className="m-0 max-w-[24ch] text-right font-mono text-[12.5px] text-ink2">
          Most tools stop at scheduling.
          <br />
          Content OS compounds.
        </p>
      </div>

      <div className="mt-11 border-t border-ink">
        {LOOP_STEPS.map((step, i) => {
          const on = i === active;
          return (
            <div
              key={step.num}
              onClick={() => pin(i)}
              className={`cursor-pointer border-b border-hair transition-colors duration-300 ${
                on ? 'bg-white' : 'bg-transparent'
              }`}
            >
              <div className="grid grid-cols-[40px_1fr] items-center gap-4 py-6 sm:grid-cols-[64px_0.5fr_1fr_40px] sm:gap-6">
                <span
                  className="font-mono text-[13px] transition-colors duration-300"
                  style={{ color: on ? step.accent : '#908D87' }}
                >
                  {step.num}
                </span>
                <span className="ed-serif text-[28px] font-medium tracking-[-0.01em] text-ink">
                  {step.label}
                </span>
                <span className="hidden text-[15.5px] leading-[1.45] text-ink2 sm:block">
                  {step.lede}
                </span>
                <span
                  className="hidden text-right font-mono text-[9.5px] tracking-[0.06em] transition-colors duration-300 sm:block"
                  style={{ color: on ? step.accent : '#908D87' }}
                >
                  {on ? 'ACTIVE' : step.mark}
                </span>
              </div>

              {on && (
                <div className="grid grid-cols-1 gap-6 pb-7 sm:grid-cols-[64px_1fr]">
                  <span className="hidden sm:block" />
                  <div
                    className="max-w-[62ch] border-l-2 pl-5"
                    style={{ borderColor: step.accent }}
                  >
                    <p className="m-0 mb-4 text-[17px] leading-[1.6] text-ink">{step.body}</p>
                    <div className="inline-flex items-center gap-3 rounded-lg border border-hair bg-white px-[14px] py-[11px]">
                      <span className="font-mono text-[9.5px] tracking-[0.06em] text-ink3">
                        {step.exLabel}
                      </span>
                      <span className="ed-serif text-[15px] text-ink">{step.ex}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
