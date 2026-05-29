'use client';

import { motion, useInView } from 'motion/react';
import { useRef } from 'react';
import { Reveal } from './primitives';
import SectionAtmosphere from './SectionAtmosphere';

const TRAITS = [
  { label: 'Directness', value: 88, tone: '#FF6B4A' },
  { label: 'Punchiness', value: 74, tone: '#5BE7D8' },
  { label: 'Warmth', value: 62, tone: '#D7B56D' },
  { label: 'Technical depth', value: 81, tone: '#B8F36A' },
  { label: 'Contrarian', value: 56, tone: '#FF6B4A' },
];

function TraitBar({ label, value, tone, delay }: { label: string; value: number; tone: string; delay: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  return (
    <div ref={ref}>
      <div className="flex items-center justify-between os-mono text-[11px]">
        <span className="text-os-soft">{label}</span>
        <span className="text-os-muted">{value}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/40">
        <motion.div
          className="h-full rounded-full"
          style={{ background: tone }}
          initial={{ width: 0 }}
          animate={inView ? { width: `${value}%` } : {}}
          transition={{ duration: 1.1, delay, ease: [0.16, 1, 0.3, 1] }}
        />
      </div>
    </div>
  );
}

export default function VoiceFingerprint() {
  return (
    <section id="voice" className="relative scroll-mt-24 py-24">
      <SectionAtmosphere tone="cyan" accent="gold" position="right" />
      <div className="relative z-10 mx-auto grid max-w-6xl grid-cols-1 items-center gap-12 px-5 sm:px-8 lg:grid-cols-2">
        <Reveal>
          <p className="os-mono text-[11px] uppercase tracking-[0.2em] text-os-muted">
            Trained, not generic
          </p>
          <h2 className="os-serif mt-3 text-[clamp(30px,4.4vw,52px)] font-light leading-[1.02] tracking-[-0.025em] text-os-text">
            Write like yourself
            <span className="os-shimmer-text italic"> on your best day.</span>
          </h2>
          <p className="mt-4 max-w-md text-[16px] leading-7 text-os-soft">
            Content OS learns your pacing, your hooks, the phrases you&apos;d never use.
            Then it routes every draft through that fingerprint, so the words sound
            like you wrote them, because they basically did.
          </p>

          {/* before / after */}
          <div className="mt-8 space-y-3">
            <div className="rounded-2xl border border-os-border bg-black/30 p-4">
              <span className="os-mono text-[10px] uppercase tracking-[0.16em] text-os-muted">
                Generic AI
              </span>
              <p className="mt-2 text-[13.5px] leading-6 text-os-muted line-through decoration-os-coral/40">
                In today&apos;s fast-paced digital landscape, leveraging content is
                crucial for unlocking growth and maximizing your brand synergy.
              </p>
            </div>
            <div className="rounded-2xl border border-os-coral/30 bg-os-coral/[0.06] p-4">
              <span className="os-mono text-[10px] uppercase tracking-[0.16em] text-os-coral">
                Your voice
              </span>
              <p className="mt-2 text-[14px] leading-6 text-os-text">
                Stop &quot;leveraging content.&quot; Post the thing you&apos;d text a
                friend. That&apos;s the version people actually reply to.
              </p>
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="os-glass relative rounded-[26px] p-6 shadow-glass">
            <div
              className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full blur-3xl"
              style={{ background: 'rgba(255,107,74,0.16)' }}
              aria-hidden
            />
            <div className="flex items-center justify-between">
              <div>
                <p className="os-mono text-[10px] uppercase tracking-[0.18em] text-os-muted">
                  Voice fingerprint
                </p>
                <p className="mt-1 text-[15px] font-semibold text-os-text">@you</p>
              </div>
              <span className="os-mono rounded-full border border-os-cyan/30 bg-os-cyan/10 px-3 py-1.5 text-[11px] text-os-cyan">
                trained on 214 posts
              </span>
            </div>

            <div className="mt-6 space-y-4">
              {TRAITS.map((t, i) => (
                <TraitBar key={t.label} {...t} delay={0.15 + i * 0.1} />
              ))}
            </div>

            <div className="mt-6 grid grid-cols-2 gap-2.5">
              <div className="rounded-xl border border-os-border bg-black/20 p-3">
                <p className="os-mono text-[10px] uppercase tracking-[0.12em] text-os-muted">
                  Favorite hook
                </p>
                <p className="mt-1 text-[12.5px] text-os-text">&quot;Most people get this backwards.&quot;</p>
              </div>
              <div className="rounded-xl border border-os-border bg-black/20 p-3">
                <p className="os-mono text-[10px] uppercase tracking-[0.12em] text-os-muted">
                  Avoided
                </p>
                <p className="mt-1 text-[12.5px] text-os-text">leverage · synergy · unlock</p>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
