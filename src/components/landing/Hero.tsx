'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, useInView, useReducedMotion, useScroll, useTransform } from 'motion/react';
import { ArrowUpRight, Sparkles } from 'lucide-react';
import Aurora from './Aurora';
import { Counter, Magnetic, MaskHeadline, PlatformGlyph } from './primitives';

const DRAFT =
  'Most content tools help you publish. Content OS keeps the whole loop moving, so the work compounds instead of resetting every Monday.';

const QUEUE = [
  { platform: 'x', label: 'Build-in-public thread', time: 'Tue 9:10a', tone: 'coral' },
  { platform: 'linkedin', label: 'Founder lesson post', time: 'Wed 8:00a', tone: 'cyan' },
  { platform: 'instagram', label: 'Carousel, 6 frames', time: 'Thu 6:30p', tone: 'gold' },
] as const;

const toneRing: Record<string, string> = {
  coral: 'text-os-coral',
  cyan: 'text-os-cyan',
  gold: 'text-os-gold',
};

function TypedDraft() {
  const ref = useRef<HTMLParagraphElement>(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  const reduced = useReducedMotion();
  const [text, setText] = useState('');

  useEffect(() => {
    if (!inView) return;
    if (reduced) {
      setText(DRAFT);
      return;
    }
    let i = 0;
    const id = setInterval(() => {
      i += 2;
      setText(DRAFT.slice(0, i));
      if (i >= DRAFT.length) clearInterval(id);
    }, 22);
    return () => clearInterval(id);
  }, [inView, reduced]);

  return (
    <p ref={ref} className="min-h-[78px] text-[14px] leading-6 text-os-text">
      {text}
      {text.length < DRAFT.length && (
        <span className="ml-0.5 inline-block h-4 w-[2px] translate-y-0.5 bg-os-coral align-middle animate-os-pulse-dot" />
      )}
    </p>
  );
}

function VoiceRing({ value = 94 }: { value?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true });
  const circumference = 2 * Math.PI * 26;
  return (
    <div ref={ref} className="relative flex h-[68px] w-[68px] items-center justify-center">
      <svg className="h-full w-full -rotate-90" viewBox="0 0 60 60">
        <circle cx="30" cy="30" r="26" fill="none" stroke="rgba(244,240,232,0.1)" strokeWidth="4" />
        <motion.circle
          cx="30"
          cy="30"
          r="26"
          fill="none"
          stroke="#5BE7D8"
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={inView ? { strokeDashoffset: circumference * (1 - value / 100) } : {}}
          transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1], delay: 0.3 }}
        />
      </svg>
      <div className="absolute text-center">
        <div className="os-mono text-[15px] font-semibold leading-none text-os-cyan">
          <Counter to={value} suffix="%" />
        </div>
        <div className="os-mono mt-0.5 text-[7px] uppercase tracking-[0.14em] text-os-muted">
          voice
        </div>
      </div>
    </div>
  );
}

export default function Hero({ loggedIn }: { loggedIn: boolean }) {
  const sectionRef = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: sectionRef,
    offset: ['start start', 'end start'],
  });
  const cockpitY = useTransform(scrollYProgress, [0, 1], [0, 90]);
  const cockpitOpacity = useTransform(scrollYProgress, [0, 0.8], [1, 0.35]);

  return (
    <section ref={sectionRef} className="relative overflow-hidden pt-32 sm:pt-36">
      <Aurora />
      <div className="relative z-10 mx-auto grid max-w-6xl grid-cols-1 gap-12 px-5 pb-16 sm:px-8 lg:grid-cols-[1.04fr_0.96fr] lg:items-center lg:pb-24">
        {/* Left: the poster */}
        <div>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="inline-flex items-center gap-2 rounded-full border border-os-border bg-os-surface px-3 py-1.5 backdrop-blur"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-os-lime animate-os-pulse-dot" />
            <span className="os-mono text-[10.5px] uppercase tracking-[0.2em] text-os-soft">
              Content&nbsp;OS · content command center
            </span>
          </motion.div>

          <h1 className="os-serif mt-6 text-[clamp(42px,7vw,88px)] font-light leading-[0.96] tracking-[-0.03em] text-os-text">
            <MaskHeadline
              immediate
              lines={[
                <>Your content engine,</>,
                <>
                  trained <span className="os-shimmer-text italic">on you.</span>
                </>,
              ]}
            />
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.55 }}
            className="mt-6 max-w-xl text-[17px] leading-7 text-os-soft"
          >
            Research what&apos;s moving, write in your own voice, schedule everywhere,
            reply faster, and learn what actually grows. One loop, not twelve tabs.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.7 }}
            className="mt-9 flex flex-wrap items-center gap-3"
          >
            <Magnetic>
              <Link
                href={loggedIn ? '/dashboard' : '/login'}
                className="group relative inline-flex items-center gap-2 overflow-hidden rounded-full bg-os-coral px-6 py-3.5 text-[15px] font-semibold text-os-bg shadow-[0_18px_50px_-12px_rgba(255,107,74,0.6)]"
              >
                <span
                  className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/45 to-transparent transition-transform duration-700 group-hover:translate-x-full"
                  aria-hidden
                />
                {loggedIn ? 'Open workspace' : 'Start building'}
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </Magnetic>
            <Link
              href="#loop"
              className="inline-flex items-center gap-2 rounded-full border border-os-border-strong px-6 py-3.5 text-[15px] font-medium text-os-text transition-colors hover:bg-os-surface"
            >
              Watch the system run
            </Link>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.9 }}
            className="mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 os-mono text-[11px] uppercase tracking-[0.14em] text-os-muted"
          >
            <span>Posts to X · LinkedIn · Instagram · Threads</span>
            <span className="hidden h-3 w-px bg-os-border sm:block" />
            <span className="text-os-soft">No credit card · setup under a minute</span>
          </motion.div>
        </div>

        {/* Right: the running cockpit */}
        <motion.div
          style={{ y: cockpitY, opacity: cockpitOpacity }}
          initial={{ opacity: 0, scale: 0.96, filter: 'blur(12px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          transition={{ duration: 1, delay: 0.35, ease: [0.16, 1, 0.3, 1] }}
          className="relative"
        >
          {/* Composer panel */}
          <div className="os-glass relative z-20 rounded-[22px] p-4 shadow-glass">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-os-coral/15 text-os-coral">
                  <PlatformGlyph platform="x" className="h-3.5 w-3.5" />
                </span>
                <div>
                  <p className="text-[12.5px] font-semibold text-os-text">Composing for @you</p>
                  <p className="os-mono text-[10px] text-os-muted">draft · in your voice</p>
                </div>
              </div>
              <VoiceRing />
            </div>
            <div className="mt-3 rounded-2xl border border-os-border bg-black/30 p-3.5">
              <TypedDraft />
            </div>
            <div className="mt-3 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                {(['x', 'linkedin', 'instagram'] as const).map((p, i) => (
                  <span
                    key={p}
                    className={`flex h-7 w-7 items-center justify-center rounded-lg border border-os-border ${
                      i === 0 ? 'bg-os-coral/15 text-os-coral' : 'text-os-muted'
                    }`}
                  >
                    <PlatformGlyph platform={p} className="h-3.5 w-3.5" />
                  </span>
                ))}
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-os-cyan/10 px-3 py-1.5 text-[11px] font-medium text-os-cyan">
                <Sparkles className="h-3 w-3" /> Reads like you
              </span>
            </div>
          </div>

          {/* Queue panel: offset, overlapping */}
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.7 }}
            className="os-glass relative z-10 -mt-3 ml-6 rounded-[22px] p-4 shadow-glass sm:ml-10"
          >
            <div className="flex items-center justify-between">
              <p className="os-mono text-[10px] uppercase tracking-[0.16em] text-os-muted">
                This week&apos;s queue
              </p>
              <span className="os-mono text-[10px] text-os-cyan">best-time on</span>
            </div>
            <div className="mt-2.5 space-y-2">
              {QUEUE.map((q, i) => (
                <motion.div
                  key={q.label}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.5, delay: 0.85 + i * 0.12 }}
                  className="flex items-center gap-3 rounded-xl border border-os-border bg-black/20 px-3 py-2"
                >
                  <span className={`${toneRing[q.tone]}`}>
                    <PlatformGlyph platform={q.platform} className="h-3.5 w-3.5" />
                  </span>
                  <span className="flex-1 truncate text-[12.5px] text-os-text">{q.label}</span>
                  <span className="os-mono text-[10.5px] text-os-muted">{q.time}</span>
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* Analytics strip: floating receipt */}
          <motion.div
            initial={{ opacity: 0, y: 16, x: 16 }}
            animate={{ opacity: 1, y: 0, x: 0 }}
            transition={{ duration: 0.8, delay: 1 }}
            className="os-glass absolute -bottom-8 -left-2 z-30 hidden items-center gap-4 rounded-2xl px-4 py-3 shadow-glass sm:flex"
          >
            <div>
              <div className="os-mono text-[18px] font-semibold leading-none text-os-lime">
                <Counter to={31} prefix="+" />
              </div>
              <div className="os-mono mt-1 text-[8.5px] uppercase tracking-[0.12em] text-os-muted">
                high-intent replies
              </div>
            </div>
            <div className="h-8 w-px bg-os-border" />
            <div>
              <div className="os-mono text-[18px] font-semibold leading-none text-os-gold">
                <Counter to={4.2} decimals={1} suffix="x" />
              </div>
              <div className="os-mono mt-1 text-[8.5px] uppercase tracking-[0.12em] text-os-muted">
                profile visits
              </div>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}
