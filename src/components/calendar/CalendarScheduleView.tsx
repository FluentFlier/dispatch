'use client';

import { useMemo } from 'react';
import type { Post } from '@/lib/types';
import PillarDot from '@/components/PillarDot';
import StatusBadge from '@/components/StatusBadge';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const PLATFORM_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn',
  twitter: 'X / Twitter',
  instagram: 'Instagram',
  threads: 'Threads',
};

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatDateHeading(dateKey: string): { day: string; date: string; month: string; year: string } {
  const d = new Date(`${dateKey}T12:00:00Z`);
  return {
    day: d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' }),
    date: String(d.getUTCDate()),
    month: d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }),
    year: String(d.getUTCFullYear()),
  };
}

function formatTime(raw: string | null | undefined): string {
  if (!raw || !raw.includes('T')) return 'All day';
  const d = new Date(raw);
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
  }) + ' UTC';
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface CalendarScheduleViewProps {
  posts: Post[];
  today: Date;
  onPostClick: (post: Post) => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * Agenda/Schedule view — shows all scheduled posts as a linear list grouped by date.
 * Past dates are shown with muted styling. Empty days are skipped.
 */
export default function CalendarScheduleView({
  posts,
  today,
  onPostClick,
}: CalendarScheduleViewProps) {
  const todayKey = toDateKey(today);

  // Group posts by scheduled_date, sorted chronologically
  const groups = useMemo(() => {
    const map: Record<string, Post[]> = {};
    for (const p of posts) {
      if (!p.scheduled_date) continue;
      const key = p.scheduled_date.slice(0, 10);
      if (!map[key]) map[key] = [];
      map[key].push(p);
    }
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, dayPosts]) => ({
        key,
        posts: dayPosts.sort((a, b) => {
          const ta = a.scheduled_publish_at ?? `${key}T12:00:00Z`;
          const tb = b.scheduled_publish_at ?? `${key}T12:00:00Z`;
          return ta.localeCompare(tb);
        }),
        isPast: key < todayKey,
        isToday: key === todayKey,
      }));
  }, [posts, todayKey]);

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center border border-hair rounded-lg bg-bg-secondary">
        <p className="text-[15px] text-text-primary font-medium">No scheduled posts</p>
        <p className="text-[13px] text-text-secondary max-w-sm">
          Drag posts from the backlog onto days, or click a day to schedule one.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-hair rounded-lg overflow-hidden bg-bg-secondary">
      {groups.map(({ key, posts: dayPosts, isPast, isToday }) => {
        const { day, date, month, year } = formatDateHeading(key);

        return (
          <div
            key={key}
            className={`flex border-b border-hair last:border-0 ${isPast ? 'opacity-60' : ''}`}
          >
            {/* Date column */}
            <div className={`w-20 shrink-0 flex flex-col items-center justify-start pt-4 pb-4 border-r border-hair ${
              isToday ? 'bg-accent-primary/5' : 'bg-bg-tertiary/40'
            }`}>
              <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-ink3">
                {day}
              </span>
              <span
                className={`font-serif text-[28px] font-normal leading-tight ${
                  isToday ? 'text-accent-primary' : 'text-ink'
                }`}
              >
                {date}
              </span>
              <span className="text-[10px] font-mono text-ink3">
                {month} {year}
              </span>
              {isToday && (
                <span className="text-[9px] font-mono uppercase tracking-[0.08em] text-accent-primary mt-1">
                  Today
                </span>
              )}
            </div>

            {/* Posts column */}
            <div className="flex-1 divide-y divide-hair/50">
              {dayPosts.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onPostClick(p)}
                  className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-bg-tertiary transition-colors group"
                >
                  {/* Time */}
                  <span className="text-[12px] font-mono text-ink3 w-24 shrink-0">
                    {formatTime(p.scheduled_publish_at)}
                  </span>

                  {/* Pillar dot */}
                  <PillarDot pillar={p.pillar} />

                  {/* Title + platform */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-text-primary truncate group-hover:text-ink">
                      {p.title}
                    </p>
                    <p className="text-[11px] font-mono text-ink3 uppercase tracking-[0.06em]">
                      {PLATFORM_LABELS[p.platform] ?? p.platform}
                    </p>
                  </div>

                  {/* Status */}
                  <StatusBadge status={p.status} />
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
