'use client';

import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { Droppable } from '@hello-pangea/dnd';
import type { Post } from '@/lib/types';
import { usePillars } from '@/hooks/usePillars';
import PillarDot from '@/components/PillarDot';
import StatusBadge from '@/components/ui/StatusBadge';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getCalendarDays(year: number, month: number): Date[] {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDate = new Date(firstDay);
  const dayOfWeek = startDate.getDay();
  const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  startDate.setDate(startDate.getDate() - diff);
  const days: Date[] = [];
  const current = new Date(startDate);
  while (current <= lastDay || days.length % 7 !== 0) {
    days.push(new Date(current));
    current.setDate(current.getDate() + 1);
  }
  return days;
}

function getWeekDays(baseDate: Date): Date[] {
  const start = new Date(baseDate);
  const dayOfWeek = start.getDay();
  const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  start.setDate(start.getDate() - diff);
  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    days.push(new Date(start));
    start.setDate(start.getDate() + 1);
  }
  return days;
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

function truncateText(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s;
}

const DAY_HEADERS_MON = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type ViewMode = 'month' | 'week';

interface CalendarGridProps {
  viewMode: ViewMode;
  currentYear: number;
  currentMonth: number;
  weekBase: Date;
  posts: Post[];
  today: Date;
  isPickMode: boolean;
  onDayCellClick: (day: Date) => void;
  onPostClick: (post: Post) => void;
}

/* ------------------------------------------------------------------ */
/*  +N More Popover                                                    */
/* ------------------------------------------------------------------ */

interface MorePopoverProps {
  posts: Post[];
  dateLabel: string;
  onPostClick: (post: Post) => void;
  onClose: () => void;
}

function MorePopover({ posts, dateLabel, onPostClick, onClose }: MorePopoverProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-bg-secondary border border-hair rounded-xl w-full max-w-xs mx-4 shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-hair">
          <span className="text-[13px] font-medium text-ink">{dateLabel}</span>
          <button onClick={onClose} className="p-1 text-text-secondary hover:text-text-primary rounded">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-2 space-y-1 max-h-[50vh] overflow-y-auto">
          {posts.map((p) => (
            <button
              key={p.id}
              onClick={() => { onPostClick(p); onClose(); }}
              className="w-full text-left flex items-center gap-2 rounded-md px-2 py-2 hover:bg-bg-tertiary transition-colors"
            >
              <PillarDot pillar={p.pillar} />
              <span className="text-[13px] text-text-primary font-medium truncate flex-1">
                {p.title}
              </span>
              <StatusBadge status={p.status} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function CalendarGrid({
  viewMode,
  currentYear,
  currentMonth,
  weekBase,
  posts,
  today,
  isPickMode,
  onDayCellClick,
  onPostClick,
}: CalendarGridProps) {
  const { getColor, getLabel } = usePillars();
  const [morePopover, setMorePopover] = useState<{ key: string; date: Date } | null>(null);

  const postsByDate = useMemo(() => {
    const map: Record<string, Post[]> = {};
    for (const p of posts) {
      if (p.scheduled_date) {
        const key = p.scheduled_date.slice(0, 10);
        if (!map[key]) map[key] = [];
        map[key].push(p);
      }
    }
    return map;
  }, [posts]);

  const calendarDays = useMemo(
    () => getCalendarDays(currentYear, currentMonth),
    [currentYear, currentMonth]
  );

  const weekDays = useMemo(() => getWeekDays(weekBase), [weekBase]);
  const days = viewMode === 'month' ? calendarDays : weekDays;

  /* Mobile list view */
  const mobileDays = viewMode === 'week'
    ? days
    : days.filter((day) => {
        const key = toDateKey(day);
        return (postsByDate[key]?.length ?? 0) > 0 || isSameDay(day, today);
      });

  const mobileListView = (
    <div className="sm:hidden space-y-2">
      {viewMode === 'month' && mobileDays.length === 0 && (
        <p className="text-[13px] text-text-secondary text-center py-4">No scheduled posts this month.</p>
      )}
      {mobileDays.map((day, i) => {
        const key = toDateKey(day);
        const isToday = isSameDay(day, today);
        const dayPosts = postsByDate[key] || [];
        const dayOfWeek = day.getDay();
        const dayLabel = DAY_HEADERS_MON[dayOfWeek === 0 ? 6 : dayOfWeek - 1];

        return (
          <Droppable key={`mobile-${key}`} droppableId={`mday-${key}`}>
            {(provided, snapshot) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                onClick={() => onDayCellClick(day)}
                className={`rounded-lg border border-hair bg-bg-secondary p-3 cursor-pointer transition-colors ${
                  isToday ? 'ring-1 ring-inset ring-accent-primary' : ''
                } ${isPickMode ? 'hover:ring-1 hover:ring-accent-primary/60' : ''} ${
                  snapshot.isDraggingOver
                    ? 'bg-coral-light ring-2 ring-inset ring-accent-primary/50'
                    : 'hover:bg-bg-tertiary'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-ink3">{dayLabel}</span>
                  <span className={`font-mono text-[14px] ${isToday ? 'text-accent-primary' : 'text-ink'}`}>
                    {viewMode === 'month'
                      ? `${day.toLocaleDateString('en-US', { month: 'short' })} ${day.getDate()}`
                      : day.getDate()}
                  </span>
                  {dayPosts.length === 0 && (
                    <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-ink3 ml-auto">No posts</span>
                  )}
                </div>
                <div className="space-y-1.5">
                  {dayPosts.map((p) => (
                    <div
                      key={p.id}
                      onClick={(e) => { e.stopPropagation(); onPostClick(p); }}
                      className="rounded-md border border-border bg-bg-tertiary p-2.5 min-h-[44px] cursor-pointer hover:border-border-hover transition-colors flex items-center gap-2"
                    >
                      <PillarDot pillar={p.pillar} />
                      <span className="text-[13px] text-text-primary font-medium truncate flex-1">
                        {truncateText(p.title, 30)}
                      </span>
                      <StatusBadge status={p.status} />
                    </div>
                  ))}
                </div>
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        );
      })}
    </div>
  );

  return (
    <div>
      {mobileListView}

      {/* Desktop grid - hidden on mobile */}
      <div className="hidden sm:block">
        {/* Day headers */}
        <div className="grid grid-cols-7 gap-px mb-px">
          {DAY_HEADERS_MON.map((d) => (
            <div key={d} className="font-mono text-center text-[10px] text-ink3 py-2 uppercase tracking-[0.12em]">
              {d}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7 border border-hair rounded-lg overflow-hidden">
          {days.map((day, i) => {
            const key = toDateKey(day);
            const isCurrentMonth = viewMode === 'month' ? day.getMonth() === currentMonth : true;
            const isToday = isSameDay(day, today);
            const dayPosts = postsByDate[key] || [];
            const isWeekView = viewMode === 'week';
            const overflow = !isWeekView && dayPosts.length > 4 ? dayPosts.length - 4 : 0;

            const col = i % 7;
            const row = Math.floor(i / 7);
            const totalRows = Math.ceil(days.length / 7);
            const borderClasses = [
              col < 6 ? 'border-r-[0.5px]' : '',
              row < totalRows - 1 ? 'border-b-[0.5px]' : '',
              'border-hair',
            ].join(' ');

            return (
              <Droppable key={i} droppableId={`day-${key}`}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    onClick={() => onDayCellClick(day)}
                    className={`bg-bg-secondary cursor-pointer transition-colors ${borderClasses} ${
                      isWeekView ? 'min-h-[220px] p-2.5' : 'min-h-[120px] p-2'
                    } ${isToday ? 'ring-1 ring-inset ring-accent-primary' : ''} ${
                      isPickMode ? 'hover:ring-1 hover:ring-accent-primary/60' : ''
                    } ${
                      snapshot.isDraggingOver
                        ? 'bg-coral-light ring-2 ring-inset ring-accent-primary/50'
                        : 'hover:bg-bg-tertiary'
                    }`}
                  >
                    {isWeekView ? (
                      <div className="mb-2">
                        <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink3">
                          {DAY_HEADERS_MON[i]}
                        </span>
                        <span className={`ml-1 font-mono text-[13px] ${isToday ? 'text-accent-primary' : 'text-ink'}`}>
                          {day.getDate()}
                        </span>
                      </div>
                    ) : (
                      <span className={`font-mono text-[13px] ${isCurrentMonth ? 'text-ink' : 'text-ink3'}`}>
                        {day.getDate()}
                      </span>
                    )}

                    <div className={isWeekView ? 'space-y-1.5' : 'mt-0.5 space-y-0.5'}>
                      {(isWeekView ? dayPosts : dayPosts.slice(0, 4)).map((p) =>
                        isWeekView ? (
                          <div
                            key={p.id}
                            onClick={(e) => { e.stopPropagation(); onPostClick(p); }}
                            className="rounded-md border border-border bg-bg-secondary p-1.5 cursor-pointer hover:border-border-hover transition-colors"
                          >
                            <div className="flex items-center gap-1 mb-0.5">
                              <PillarDot pillar={p.pillar} />
                              <span className="text-[11px] text-text-primary font-medium truncate">
                                {truncateText(p.title, 20)}
                              </span>
                            </div>
                            <StatusBadge status={p.status} />
                          </div>
                        ) : (
                          <div
                            key={p.id}
                            onClick={(e) => { e.stopPropagation(); onPostClick(p); }}
                            className="rounded-[3px] px-1.5 py-1 text-[11px] leading-tight font-medium truncate cursor-pointer hover:opacity-80"
                            style={{
                              backgroundColor: `${getColor(p.pillar)}25`,
                              color: getColor(p.pillar),
                            }}
                            title={`${p.title} (${getLabel(p.pillar)})`}
                          >
                            {truncateText(p.title, 18)}
                          </div>
                        )
                      )}

                      {/* "+N more" clickable link */}
                      {overflow > 0 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setMorePopover({ key, date: day });
                          }}
                          className="text-[10px] text-accent-primary hover:underline font-medium"
                        >
                          +{overflow} more
                        </button>
                      )}
                    </div>
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>
            );
          })}
        </div>
      </div>

      {/* "+N more" popover */}
      {morePopover && (
        <MorePopover
          posts={postsByDate[morePopover.key] ?? []}
          dateLabel={morePopover.date.toLocaleDateString('en-US', {
            weekday: 'long', month: 'long', day: 'numeric',
          })}
          onPostClick={onPostClick}
          onClose={() => setMorePopover(null)}
        />
      )}
    </div>
  );
}
