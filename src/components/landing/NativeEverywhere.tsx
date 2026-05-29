'use client';

import { Reveal, PlatformGlyph } from './primitives';
import SectionAtmosphere from './SectionAtmosphere';
import { FileText, Film, CornerDownRight, LayoutGrid } from 'lucide-react';

const BRANCHES = [
  {
    kind: 'platform' as const,
    platform: 'x' as const,
    title: 'X thread',
    body: '7 posts. Hook → proof → turn. Each line earns the next.',
    tone: 'text-os-coral',
  },
  {
    kind: 'platform' as const,
    platform: 'linkedin' as const,
    title: 'LinkedIn post',
    body: 'Longer, slower, story-led. Built for the scroll-and-pause.',
    tone: 'text-os-cyan',
  },
  {
    kind: 'icon' as const,
    icon: FileText,
    title: 'Newsletter intro',
    body: 'The same idea, warmed up for inbox attention.',
    tone: 'text-os-gold',
  },
  {
    kind: 'icon' as const,
    icon: Film,
    title: 'Short-form script',
    body: 'Beats and on-screen text, paced for 30 seconds.',
    tone: 'text-os-lime',
  },
  {
    kind: 'icon' as const,
    icon: CornerDownRight,
    title: 'Reply prompt',
    body: 'A ready answer for the comment this will trigger.',
    tone: 'text-os-coral',
  },
  {
    kind: 'icon' as const,
    icon: LayoutGrid,
    title: 'Carousel outline',
    body: '6 frames. One point per frame, saved not skipped.',
    tone: 'text-os-cyan',
  },
];

export default function NativeEverywhere() {
  return (
    <section id="everywhere" className="relative scroll-mt-24 py-24">
      <SectionAtmosphere tone="gold" accent="coral" position="left" />
      <div className="relative z-10 mx-auto max-w-6xl px-5 sm:px-8">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <Reveal>
            <p className="os-mono text-[11px] uppercase tracking-[0.2em] text-os-muted">
              One source, many shapes
            </p>
            <h2 className="os-serif mt-3 text-[clamp(30px,4.4vw,52px)] font-light leading-[1.02] tracking-[-0.025em] text-os-text">
              One idea, native
              <span className="os-shimmer-text italic"> everywhere.</span>
            </h2>
            <p className="mt-4 max-w-md text-[16px] leading-7 text-os-soft">
              Write the idea once. Content OS reshapes it for each platform&apos;s
              native rhythm, not copy-paste cross-posting that gets you ignored.
            </p>

            <div className="mt-7 os-glass inline-flex max-w-sm items-start gap-3 rounded-2xl p-4 shadow-glass">
              <span className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg bg-os-coral/15 text-os-coral os-mono text-[12px]">
                ✶
              </span>
              <div>
                <p className="os-mono text-[10px] uppercase tracking-[0.16em] text-os-muted">
                  Source idea
                </p>
                <p className="mt-1 text-[14px] leading-6 text-os-text">
                  &quot;Replies are the most underrated growth channel in content.&quot;
                </p>
              </div>
            </div>
          </Reveal>

          <div className="relative grid grid-cols-1 gap-3 sm:grid-cols-2">
            {BRANCHES.map((b, i) => (
              <Reveal key={b.title} delay={i * 0.07}>
                <div className="group h-full rounded-2xl border border-os-border bg-os-surface-strong/60 p-4 backdrop-blur transition-all hover:-translate-y-0.5 hover:border-os-border-strong">
                  <div className="flex items-center gap-2.5">
                    <span className={`flex h-8 w-8 items-center justify-center rounded-lg border border-os-border bg-black/40 ${b.tone}`}>
                      {b.kind === 'platform' ? (
                        <PlatformGlyph platform={b.platform} className="h-3.5 w-3.5" />
                      ) : (
                        <b.icon className="h-4 w-4" strokeWidth={1.6} />
                      )}
                    </span>
                    <h3 className="text-[14px] font-semibold text-os-text">{b.title}</h3>
                  </div>
                  <p className="mt-2.5 text-[12.5px] leading-5 text-os-muted">{b.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
