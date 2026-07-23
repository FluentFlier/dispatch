'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useReducedMotion } from 'motion/react';

export type ActivityItem = {
  id: string;
  title: string;
  /** Pre-formatted on the server so the feed never re-computes relative time client-side. */
  meta: string;
  color: string;
  href: string;
};

/** Pixels the feed drifts per tick, and how often it ticks. */
const DRIFT_PX = 0.4;
const TICK_MS = 40;

/**
 * Recent activity as a slowly self-scrolling list that the user can also grab
 * and scroll by hand.
 *
 * It used to be an absolutely-positioned card stack driven by framer transforms
 * - it looked alive but could not be scrolled at all, and its tall rows showed
 * only three items. This is a real scroll container: the auto-drift nudges
 * scrollTop a fraction of a pixel each tick and loops at the bottom, hovering
 * pauses it and reveals a thin scrollbar (see .hover-scroll), and the shorter
 * rows fit more of the list on screen at once.
 */
export function RecentActivityFeed({ items }: { items: ActivityItem[] }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);

  const drifts = items.length > 4 && !reduce && !paused;

  useEffect(() => {
    if (!drifts) return;
    const el = ref.current;
    if (!el) return;
    const t = setInterval(() => {
      // Loop back to the top a hair before the true end so the jump is unseen.
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) {
        el.scrollTop = 0;
      } else {
        el.scrollTop += DRIFT_PX;
      }
    }, TICK_MS);
    return () => clearInterval(t);
  }, [drifts]);

  return (
    <div
      ref={ref}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="hover-scroll mt-3 max-h-[220px] flex-1 space-y-2 overflow-y-auto pr-1 text-ink3"
    >
      {items.map((item) => (
        <Link
          key={item.id}
          href={item.href}
          className="flex items-center gap-3 rounded-card border border-hair bg-white/70 px-3 py-2 transition-colors hover:bg-paper2/60"
        >
          <span
            className="inline-block h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: item.color }}
          />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-ink">{item.title}</p>
            <p className="mt-0.5 text-xs text-ink3">{item.meta}</p>
          </div>
        </Link>
      ))}
    </div>
  );
}
