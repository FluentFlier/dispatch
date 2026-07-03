'use client';

import { useEffect, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { WALK_STEPS } from './data';

/** Dark timeline — one week in the loop. */
export default function Week() {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setActive((i) => (i + 1) % WALK_STEPS.length), 3300);
    return () => clearInterval(t);
  }, [reduce]);

  const scene = WALK_STEPS[active];

  return (
    <section id="week" className="scroll-mt-24 border-t border-hair bg-[#0E0E10] text-paper">
      <div className="mx-auto max-w-[1180px] px-5 py-14 sm:px-10 sm:py-20">
        <span className="font-mono text-[11.5px] tracking-[0.12em] text-[#FF7A5C]">06 / IN PRACTICE</span>
        <h2 className="ed-serif mt-4 max-w-[16ch] text-[clamp(28px,4vw,48px)] font-normal leading-[1.02] tracking-[-0.03em] text-paper">
          Event to idea in one week.
        </h2>

        <div className="mt-10 grid grid-cols-1 items-start gap-10 lg:grid-cols-[240px_1fr]">
          <div className="flex flex-col">
            {WALK_STEPS.map((step, i) => {
              const on = i === active;
              return (
                <button
                  key={step.num}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setActive(i)}
                  className={`grid w-full grid-cols-[72px_1fr] items-center gap-3 py-3 text-left ${
                    i === 0 ? '' : 'border-t border-[rgba(244,242,236,0.12)]'
                  }`}
                >
                  <span
                    className="font-mono text-[10px] transition-colors duration-300"
                    style={{ color: on ? step.accent : 'rgba(244,242,236,0.4)' }}
                  >
                    {step.num}
                  </span>
                  <span
                    className="text-[14px] transition-all duration-300"
                    style={{
                      fontWeight: on ? 600 : 400,
                      color: on ? '#FBFAF7' : 'rgba(244,242,236,0.5)',
                    }}
                  >
                    {step.label}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="relative min-h-[200px] overflow-hidden border-t border-[rgba(244,242,236,0.16)] lg:border-t-0 lg:border-l lg:pl-10">
            <div className="py-6">
              <span
                className="inline-block rounded border px-2 py-1 font-mono text-[10px] tracking-[0.1em]"
                style={{ color: scene.accent, borderColor: scene.accent }}
              >
                {scene.tag}
              </span>
              <h3 className="ed-serif my-5 max-w-[20ch] text-[clamp(24px,3vw,40px)] font-normal leading-[1.05] text-paper">
                {scene.line}
              </h3>
              <span className="font-mono text-[11px]" style={{ color: scene.accent }}>
                {scene.metric}
              </span>
            </div>
            <div className="ed-serif pointer-events-none absolute right-0 top-2 text-[clamp(72px,18vw,130px)] font-medium leading-none text-[rgba(244,242,236,0.05)]">
              {scene.big}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
