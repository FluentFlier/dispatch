'use client';

import { MessageCircle, Bookmark, ArrowUpRight } from 'lucide-react';
import { PlatformGlyph, Reveal } from './primitives';
import SectionAtmosphere from './SectionAtmosphere';

type Receipt = {
  platform: 'x' | 'linkedin' | 'instagram' | 'threads' | 'youtube';
  handle: string;
  text: string;
  replies: number;
  saves: number;
  next: string;
  accent: string;
};

const RECEIPTS: Receipt[] = [
  {
    platform: 'x',
    handle: '@maya.builds',
    text: 'Shipped the thing nobody asked for. Turns out 9 people did.',
    replies: 142,
    saves: 318,
    next: 'Turn top reply into a thread',
    accent: 'text-os-coral',
  },
  {
    platform: 'linkedin',
    handle: 'Devin O. · Founder',
    text: 'The quiet metric nobody tracks: how fast you reply to your own audience.',
    replies: 89,
    saves: 540,
    next: 'Schedule the follow-up',
    accent: 'text-os-cyan',
  },
  {
    platform: 'instagram',
    handle: '@studioflow',
    text: '6-frame carousel on pricing psychology. Saved more than it liked.',
    replies: 37,
    saves: 1209,
    next: 'Clip into a Reel',
    accent: 'text-os-gold',
  },
  {
    platform: 'threads',
    handle: '@nina.writes',
    text: 'Wrote it the way I actually talk. First post over 1k in months.',
    replies: 64,
    saves: 211,
    next: 'Reuse this hook pattern',
    accent: 'text-os-lime',
  },
  {
    platform: 'x',
    handle: '@foundermode',
    text: 'Replies are the new DMs. Three turned into calls this week.',
    replies: 203,
    saves: 96,
    next: 'Tag as high-intent',
    accent: 'text-os-coral',
  },
];

function ReceiptCard({ r }: { r: Receipt }) {
  return (
    <article className="w-[320px] shrink-0 rounded-2xl border border-os-border bg-os-surface-strong/70 p-4 backdrop-blur">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className={`flex h-8 w-8 items-center justify-center rounded-full bg-black/40 ${r.accent}`}>
            <PlatformGlyph platform={r.platform} className="h-3.5 w-3.5" />
          </span>
          <span className="text-[12.5px] font-medium text-os-text">{r.handle}</span>
        </div>
        <span className="os-mono text-[10px] text-os-muted">posted via Content&nbsp;OS</span>
      </div>
      <p className="mt-3 text-[14px] leading-6 text-os-soft">{r.text}</p>
      <div className="mt-4 flex items-center gap-4 os-mono text-[11px] text-os-muted">
        <span className="inline-flex items-center gap-1.5">
          <MessageCircle className="h-3.5 w-3.5" /> {r.replies}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Bookmark className="h-3.5 w-3.5" /> {r.saves}
        </span>
      </div>
      <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-os-border bg-black/30 px-2.5 py-2 text-[11.5px] text-os-text">
        <ArrowUpRight className={`h-3.5 w-3.5 ${r.accent}`} />
        <span className="text-os-muted">next:</span> {r.next}
      </div>
    </article>
  );
}

export default function PostReceipts() {
  const row = [...RECEIPTS, ...RECEIPTS];
  return (
    <section className="relative overflow-hidden border-y border-os-border py-14">
      <SectionAtmosphere tone="cyan" accent="coral" position="right" />
      <div className="relative z-10 mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal>
          <p className="os-mono text-[11px] uppercase tracking-[0.2em] text-os-muted">
            Proof, not a logo wall
          </p>
          <h2 className="os-serif mt-2 max-w-2xl text-[clamp(24px,3.4vw,36px)] font-light leading-tight tracking-[-0.02em] text-os-text">
            Real posts, the replies they triggered, and what to do next.
          </h2>
        </Reveal>
      </div>

      <div className="relative z-10 mt-9 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)]">
        <div className="flex w-max gap-4 px-4 animate-os-marquee">
          {row.map((r, i) => (
            <ReceiptCard key={`${r.handle}-${i}`} r={r} />
          ))}
        </div>
      </div>
    </section>
  );
}
