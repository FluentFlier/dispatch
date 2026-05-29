'use client';

import { Counter, Reveal } from './primitives';
import SectionAtmosphere from './SectionAtmosphere';

const METRICS = [
  { value: 38, suffix: '', tone: 'text-os-gold', label: 'ideas that became pipeline', sub: 'tracked from draft to reply to call' },
  { value: 6.4, decimals: 1, suffix: 'x', tone: 'text-os-cyan', label: 'more conversations per post', sub: 'replies, not just impressions' },
  { value: 91, suffix: '%', tone: 'text-os-coral', label: 'drafts kept on first pass', sub: 'because they already sound like you' },
];

const COMPOUNDS = [
  'Hooks your audience repeats back to you',
  'Topics worth doubling down on next week',
  'Replies that turned into real relationships',
  'The post format that quietly outperforms',
];

export default function WhatCompounds() {
  return (
    <section className="relative py-24">
      <SectionAtmosphere tone="gold" accent="lime" position="center" />
      <div className="relative z-10 mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal className="max-w-2xl">
          <p className="os-mono text-[11px] uppercase tracking-[0.2em] text-os-muted">
            Analytics worth reading
          </p>
          <h2 className="os-serif mt-3 text-[clamp(30px,4.4vw,52px)] font-light leading-[1.02] tracking-[-0.025em] text-os-text">
            What actually
            <span className="os-shimmer-text italic"> compounds.</span>
          </h2>
          <p className="mt-4 text-[16px] leading-7 text-os-soft">
            No vanity dashboard. Content OS tells you which ideas became outcomes,
            so next week starts ahead of this one.
          </p>
        </Reveal>

        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-3">
          {METRICS.map((m, i) => (
            <Reveal key={m.label} delay={i * 0.1}>
              <div className="h-full rounded-2xl border border-os-border bg-os-surface-strong/60 p-6 backdrop-blur">
                <div className={`os-mono text-[clamp(34px,5vw,52px)] font-semibold leading-none ${m.tone}`}>
                  <Counter to={m.value} decimals={m.decimals ?? 0} suffix={m.suffix} />
                </div>
                <p className="mt-4 text-[14px] font-medium text-os-text">{m.label}</p>
                <p className="mt-1 text-[12.5px] text-os-muted">{m.sub}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal delay={0.15}>
          <div className="mt-4 grid grid-cols-1 gap-x-8 gap-y-3 rounded-2xl border border-os-border bg-black/20 p-6 sm:grid-cols-2">
            {COMPOUNDS.map((c) => (
              <div key={c} className="flex items-center gap-3 text-[14px] text-os-soft">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-os-lime" />
                {c}
              </div>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
