'use client';

import { useEffect, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { WALK_STEPS } from './data';

/**
 * "A Week in the Loop" — the single dark cinematic moment. A six-step timeline auto-
 * advances every 3.3s (and jumps on click); the active step swaps the scene tag, line,
 * copy, metric, per-step accent, and the giant faint watermark number. Clicking a step
 * does not pin (unlike the Loop) — it just jumps and lets autoplay continue.
 */
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
    <section id="week" className="mt-14 bg-[#0E0E10] text-paper">
      <div className="mx-auto max-w-[1180px] px-10 py-24">
        <div className="mb-[52px]">
          <span className="font-mono text-[11.5px] tracking-[0.12em] text-[#FF7A5C]">
            06 / A WEEK IN THE LOOP
          </span>
          <h2 className="ed-serif mt-[18px] max-w-[18ch] text-[clamp(30px,4vw,54px)] font-normal leading-[1.0] tracking-[-0.03em] text-paper">
            From a calendar event to next week&apos;s idea.
          </h2>
        </div>

        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-[280px_1fr]">
          <div className="flex flex-col">
            {WALK_STEPS.map((step, i) => {
              const on = i === active;
              return (
                <button
                  key={step.num}
                  onClick={() => setActive(i)}
                  className={`grid w-full grid-cols-[90px_1fr] items-center gap-[14px] py-[14px] text-left ${
                    i === 0 ? '' : 'border-t border-[rgba(244,242,236,0.12)]'
                  }`}
                >
                  <span
                    className="font-mono text-[10.5px] tracking-[0.02em] transition-colors duration-300"
                    style={{ color: on ? step.accent : 'rgba(244,242,236,0.4)' }}
                  >
                    {step.num}
                  </span>
                  <span
                    className="text-[14.5px] transition-all duration-300"
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

          <div className="relative min-h-[320px] border-t border-[rgba(244,242,236,0.16)]">
            <div className="py-9">
              <span
                className="inline-block rounded-md border px-[11px] py-[5px] font-mono text-[11px] tracking-[0.1em] transition-colors duration-500"
                style={{ color: scene.accent, borderColor: scene.accent }}
              >
                {scene.tag}
              </span>
              <h3 className="ed-serif my-[22px] max-w-[18ch] text-[clamp(26px,3.4vw,44px)] font-normal leading-[1.04] tracking-[-0.02em] text-paper">
                {scene.line}
              </h3>
              <p className="m-0 mb-7 max-w-[54ch] text-[17px] leading-[1.6] text-[rgba(244,242,236,0.7)]">
                {scene.sub}
              </p>
              <div
                className="inline-flex items-center gap-2 rounded-full border border-[rgba(244,242,236,0.16)] bg-[rgba(244,242,236,0.04)] px-[15px] py-2 transition-colors duration-500"
                style={{ color: scene.accent }}
              >
                <span className="font-mono text-[11.5px]">{scene.metric}</span>
              </div>
            </div>
            <div className="ed-serif pointer-events-none absolute right-0 top-[18px] text-[150px] font-medium leading-none text-[rgba(244,242,236,0.05)]">
              {scene.big}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
