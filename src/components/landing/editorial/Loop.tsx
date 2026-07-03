'use client';

import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { LOOP_STEPS } from './data';

/** Five-step loop accordion. Auto-advances until a row is clicked. */
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
    <section id="loop" className="scroll-mt-24 mx-auto max-w-[1180px] border-t border-hair px-5 pb-10 pt-14 sm:px-10 sm:pt-20">
      <span className="font-mono text-[11.5px] tracking-[0.12em] text-flame">03 / THE LOOP</span>
      <h2 className="ed-serif mt-4 text-[clamp(28px,4vw,52px)] font-normal leading-[0.98] tracking-[-0.03em] text-ink">
        Signal → ship → learn.
      </h2>

      <div className="mt-8 border-t border-ink">
        {LOOP_STEPS.map((step, i) => {
          const on = i === active;
          return (
            <div key={step.num} className="border-b border-hair">
              <button
                type="button"
                aria-expanded={on}
                aria-controls={`loop-panel-${i}`}
                onClick={() => pin(i)}
                className={`w-full cursor-pointer text-left transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue focus-visible:ring-inset ${
                  on ? 'bg-white' : 'bg-transparent'
                }`}
              >
                <div className="grid grid-cols-[40px_1fr] items-center gap-4 py-5 sm:grid-cols-[56px_0.45fr_1fr_36px] sm:gap-5">
                  <span
                    className="font-mono text-[13px] transition-colors duration-300"
                    style={{ color: on ? step.accent : '#908D87' }}
                  >
                    {step.num}
                  </span>
                  <span className="ed-serif text-[24px] font-medium tracking-[-0.01em] text-ink sm:text-[26px]">
                    {step.label}
                  </span>
                  <span
                    className={`text-[15px] text-ink2 ${on ? 'block' : 'hidden sm:block'}`}
                  >
                    {step.lede}
                  </span>
                  <span
                    className="hidden text-right font-mono text-[9.5px] tracking-[0.06em] sm:block"
                    style={{ color: on ? step.accent : '#908D87' }}
                  >
                    {on ? '●' : step.mark}
                  </span>
                </div>
              </button>

              {on && (
                <div id={`loop-panel-${i}`} className="grid grid-cols-1 pb-5 sm:grid-cols-[56px_1fr]">
                  <span className="hidden sm:block" />
                  <div
                    className="inline-flex items-center gap-3 border-l-2 pl-4"
                    style={{ borderColor: step.accent }}
                  >
                    <span className="font-mono text-[9.5px] tracking-[0.06em] text-ink3">
                      {step.exLabel}
                    </span>
                    <span className="ed-serif text-[15px] text-ink">{step.ex}</span>
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
