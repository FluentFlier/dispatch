'use client';

import { useEffect, useRef } from 'react';
import type { Post } from '@/lib/types';
import { usePillars } from '@/hooks/usePillars';
import PillarDot from '@/components/PillarDot';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const HOUR_HEIGHT = 60; // px per hour (1px per minute)
const START_HOUR = 0;   // midnight
const TOTAL_HOURS = 24;
const TOTAL_HEIGHT = TOTAL_HOURS * HOUR_HEIGHT;

function formatHour(h: number): string {
  if (h === 0) return '12 AM';
  if (h < 12) return `${h} AM`;
  if (h === 12) return '12 PM';
  return `${h - 12} PM`;
}

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface CalendarDayViewProps {
  selectedDay: Date;
  today: Date;
  posts: Post[];
  onPostClick: (post: Post) => void;
  /** Called with the date + HH:MM time string for the clicked hour slot */
  onTimeSlotClick: (date: Date, time: string) => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * Google Calendar-style hourly day view.
 * Posts are positioned at their scheduled UTC time.
 * Clicking empty slots opens the schedule modal at that time.
 */
export default function CalendarDayView({
  selectedDay,
  today,
  posts,
  onPostClick,
  onTimeSlotClick,
}: CalendarDayViewProps) {
  const { getColor } = usePillars();
  const scrollRef = useRef<HTMLDivElement>(null);
  const isToday = isSameDay(selectedDay, today);
  const dayKey = toDateKey(selectedDay);

  // Posts for this specific day
  const dayPosts = posts.filter((p) => {
    if (!p.scheduled_date) return false;
    return p.scheduled_date.slice(0, 10) === dayKey;
  });

  // All-day posts (no scheduled_publish_at time component - only date)
  const allDayPosts = dayPosts.filter((p) => !p.scheduled_publish_at);
  const timedPosts = dayPosts.filter((p) => !!p.scheduled_publish_at);

  // Current time in minutes from midnight (UTC)
  const now = new Date();
  const nowUTCMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  const nowTop = nowUTCMinutes * (HOUR_HEIGHT / 60);

  // Auto-scroll to 8am on mount
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 8 * HOUR_HEIGHT - 32;
    }
  }, [dayKey]);

  function handleSlotClick(hour: number) {
    const time = `${String(hour).padStart(2, '0')}:00`;
    onTimeSlotClick(selectedDay, time);
  }

  return (
    <div className="flex flex-col h-full border border-hair rounded-lg overflow-hidden bg-bg-secondary">

      {/* ── Day header ── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-hair shrink-0">
        <div>
          <p className="text-[11px] tracking-[0.1em] text-ink3">
            {DAY_NAMES[selectedDay.getDay()]}
          </p>
          <div className="flex items-baseline gap-1.5 mt-0.5">
            <span
              className={`text-[32px] font-normal leading-none tabular-nums ${
                isToday ? 'text-accent-primary' : 'text-ink'
              }`}
            >
              {selectedDay.getDate()}
            </span>
            <span className="text-[13px] text-ink3">
              {MONTH_NAMES_SHORT[selectedDay.getMonth()]} {selectedDay.getFullYear()}
            </span>
          </div>
        </div>
        {isToday && (
          <span className="ml-auto text-[11px] tracking-[0.08em] text-accent-primary">
            Today
          </span>
        )}
      </div>

      {/* ── All-day row ── */}
      {allDayPosts.length > 0 && (
        <div className="flex items-start gap-2 px-4 py-2 border-b border-hair bg-bg-tertiary/50 shrink-0">
          <span className="text-[10px] tracking-[0.08em] text-ink3 w-14 shrink-0 pt-0.5 tabular-nums">
            All day
          </span>
          <div className="flex flex-wrap gap-1.5 flex-1">
            {allDayPosts.map((p) => (
              <button
                key={p.id}
                onClick={() => onPostClick(p)}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md text-[12px] font-medium cursor-pointer hover:opacity-80 transition-opacity"
                style={{
                  backgroundColor: `${getColor(p.pillar)}20`,
                  color: getColor(p.pillar),
                  border: `1px solid ${getColor(p.pillar)}40`,
                }}
              >
                <PillarDot pillar={p.pillar} />
                {p.title.slice(0, 30)}{p.title.length > 30 ? '…' : ''}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Hourly grid ── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="flex">

          {/* Time gutter */}
          <div className="w-16 shrink-0 relative" style={{ height: TOTAL_HEIGHT }}>
            {Array.from({ length: TOTAL_HOURS }, (_, h) => (
              <div
                key={h}
                className="absolute left-0 right-0 flex items-start justify-end pr-2"
                style={{ top: h * HOUR_HEIGHT - 8, height: HOUR_HEIGHT }}
              >
                {h > 0 && (
                  <span className="text-[10px] text-ink3 select-none">
                    {formatHour(h)}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Grid + posts */}
          <div
            className="flex-1 relative border-l border-hair"
            style={{ height: TOTAL_HEIGHT }}
          >
            {/* Hour lines */}
            {Array.from({ length: TOTAL_HOURS }, (_, h) => (
              <div
                key={h}
                className="absolute left-0 right-0 border-t border-hair/60 cursor-pointer group"
                style={{ top: h * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                onClick={() => handleSlotClick(h)}
              >
                {/* Half-hour line */}
                <div
                  className="absolute left-0 right-0 border-t border-hair/30"
                  style={{ top: HOUR_HEIGHT / 2 }}
                />
                {/* Hover highlight */}
                <div className="absolute inset-0 bg-accent-primary/0 group-hover:bg-accent-primary/5 transition-colors" />
              </div>
            ))}

            {/* Current time indicator (only when viewing today) */}
            {isToday && (
              <div
                className="absolute left-0 right-0 flex items-center pointer-events-none z-20"
                style={{ top: nowTop }}
              >
                <div className="w-2 h-2 rounded-full bg-red-500 -ml-1 shrink-0" />
                <div className="flex-1 border-t-2 border-red-500" />
              </div>
            )}

            {/* Timed posts */}
            {timedPosts.map((p) => {
              const d = new Date(p.scheduled_publish_at!);
              const utcMinutes = d.getUTCHours() * 60 + d.getUTCMinutes();
              const topPx = utcMinutes * (HOUR_HEIGHT / 60);
              const color = getColor(p.pillar);

              return (
                <button
                  key={p.id}
                  onClick={(e) => { e.stopPropagation(); onPostClick(p); }}
                  className="absolute left-1 right-1 rounded-md px-2 py-1 text-left z-10 hover:opacity-90 transition-opacity min-h-[28px]"
                  style={{
                    top: topPx,
                    backgroundColor: `${color}20`,
                    border: `1px solid ${color}50`,
                  }}
                >
                  <p
                    className="text-[12px] font-medium truncate leading-tight"
                    style={{ color }}
                  >
                    {p.title}
                  </p>
                  <p className="text-[10px] opacity-70" style={{ color }}>
                    {d.toLocaleTimeString('en-US', {
                      hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
                    })} UTC · {p.platform}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
