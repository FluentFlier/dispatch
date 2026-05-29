'use client';

import { motion } from 'motion/react';
import { Radar, PenLine, CalendarClock, MessagesSquare, LineChart, RefreshCw } from 'lucide-react';
import { Reveal } from './primitives';

const STEPS = [
  {
    icon: Radar,
    tone: 'text-os-cyan',
    glow: 'rgba(91,231,216,0.18)',
    kicker: 'Signal',
    title: 'See what the feed is rewarding',
    detail: 'Hooks gaining traction, niche keywords, competitor angles, reply sentiment.',
  },
  {
    icon: PenLine,
    tone: 'text-os-coral',
    glow: 'rgba(255,107,74,0.18)',
    kicker: 'Draft',
    title: 'Write in your trained voice',
    detail: 'Every draft routes through your voice fingerprint before it ever ships.',
  },
  {
    icon: CalendarClock,
    tone: 'text-os-gold',
    glow: 'rgba(215,181,109,0.16)',
    kicker: 'Publish',
    title: 'Schedule native everywhere',
    detail: 'One idea, platform-shaped for X, LinkedIn, Instagram, Threads, at the right time.',
  },
  {
    icon: MessagesSquare,
    tone: 'text-os-lime',
    glow: 'rgba(184,243,106,0.16)',
    kicker: 'Reply',
    title: 'Treat replies as growth',
    detail: 'High-intent replies surface first. Turn the best one into the next post.',
  },
  {
    icon: LineChart,
    tone: 'text-os-cyan',
    glow: 'rgba(91,231,216,0.18)',
    kicker: 'Learn',
    title: 'Keep what compounds',
    detail: 'Topics worth doubling down on, hooks your audience repeats back to you.',
  },
];

export default function TheLoop() {
  return (
    <section id="loop" className="relative scroll-mt-24 py-24">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal className="max-w-2xl">
          <p className="os-mono text-[11px] uppercase tracking-[0.2em] text-os-muted">
            It isn&apos;t a feature list. It&apos;s a loop
          </p>
          <h2 className="os-serif mt-3 text-[clamp(30px,4.4vw,52px)] font-light leading-[1.02] tracking-[-0.025em] text-os-text">
            Signal, draft, publish, reply, learn.
            <span className="os-shimmer-text italic"> Repeat.</span>
          </h2>
          <p className="mt-4 text-[16px] leading-7 text-os-soft">
            Most tools stop at publish. Content OS closes the loop, so every week
            builds on the last instead of starting from a blank page.
          </p>
        </Reveal>

        <div className="relative mt-14">
          <div
            className="pointer-events-none absolute left-0 right-0 top-[46px] hidden h-px bg-gradient-to-r from-transparent via-os-border-strong to-transparent lg:block"
            aria-hidden
          />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              return (
                <Reveal key={s.kicker} delay={i * 0.08}>
                  <div className="group relative h-full overflow-hidden rounded-2xl border border-os-border bg-os-surface-strong/60 p-5 backdrop-blur transition-colors hover:border-os-border-strong">
                    <div
                      className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full blur-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-100"
                      style={{ background: s.glow }}
                      aria-hidden
                    />
                    <div className="flex items-center justify-between">
                      <span
                        className={`relative z-10 flex h-10 w-10 items-center justify-center rounded-xl border border-os-border bg-black/40 ${s.tone}`}
                      >
                        <Icon className="h-4.5 w-4.5" strokeWidth={1.6} />
                      </span>
                      <span className="os-mono text-[10px] text-os-muted">0{i + 1}</span>
                    </div>
                    <p className={`os-mono mt-4 text-[10.5px] uppercase tracking-[0.18em] ${s.tone}`}>
                      {s.kicker}
                    </p>
                    <h3 className="mt-1.5 text-[15px] font-semibold leading-snug text-os-text">
                      {s.title}
                    </h3>
                    <p className="mt-2 text-[12.5px] leading-5 text-os-muted">{s.detail}</p>
                  </div>
                </Reveal>
              );
            })}
          </div>

          <Reveal delay={0.2}>
            <div className="mt-5 flex items-center justify-center gap-2 os-mono text-[11px] uppercase tracking-[0.16em] text-os-muted">
              <motion.span
                animate={{ rotate: 360 }}
                transition={{ duration: 9, repeat: Infinity, ease: 'linear' }}
                className="text-os-coral"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </motion.span>
              the loop closes: replies become the next signal
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
