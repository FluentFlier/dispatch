'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

export type ActivityItem = {
  id: string;
  title: string;
  /** Pre-formatted on the server so the feed never re-computes relative time client-side. */
  meta: string;
  color: string;
  href: string;
};

const VISIBLE = 3;
const INTERVAL = 3500;

/**
 * Recent activity rendered as a stacked, self-cycling feed: a fresh item slides
 * in at the top every few seconds and pushes the rest down under a fade mask.
 */
export function RecentActivityFeed({ items }: { items: ActivityItem[] }) {
  const reduce = useReducedMotion();
  const cycles = items.length > VISIBLE && !reduce;
  const [head, setHead] = useState(0);

  useEffect(() => {
    if (!cycles) return;
    const t = setInterval(
      () => setHead((h) => (h - 1 + items.length) % items.length),
      INTERVAL,
    );
    return () => clearInterval(t);
  }, [cycles, items.length]);

  const count = Math.min(VISIBLE, items.length);
  const visible = Array.from(
    { length: count },
    (_, i) => items[(head + i) % items.length],
  );

  return (
    // Rows are sized as a fraction of the container, so the feed fills whatever
    // height the surrounding card has. `y` is in multiples of a row's own height,
    // which is exactly one slot - no pixel measuring needed.
    <div className="relative mt-3 min-h-[228px] flex-1 overflow-hidden [mask-image:linear-gradient(to_bottom,black_75%,transparent_100%)]">
      <AnimatePresence initial={false}>
        {visible.map((item, i) => (
          <motion.div
            key={item.id}
            className="absolute inset-x-0 top-0 pb-2"
            style={{ height: `${100 / count}%` }}
            initial={{ opacity: 0, y: '-100%', scale: 0.96 }}
            animate={{ opacity: 1, y: `${i * 100}%`, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.2 } }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
          >
            <Link
              href={item.href}
              className="flex h-full items-center gap-3 rounded-card border border-hair bg-white/70 px-3 transition-colors hover:bg-paper2/60"
            >
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: item.color }}
              />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink">{item.title}</p>
                <p className="mt-0.5 text-xs text-ink3">{item.meta}</p>
              </div>
            </Link>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
