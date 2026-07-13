'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Sparkles, CalendarDays } from 'lucide-react';
import { Droppable, Draggable } from '@hello-pangea/dnd';
import type { Post } from '@/lib/types';
import type { PillarInfo } from '@/hooks/usePillars';
import PillarDot from '@/components/PillarDot';
import { postPillars } from '@/lib/pillars';
import StatusBadge from '@/components/ui/StatusBadge';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAY_MINI = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getMiniCalDays(year: number, month: number): Date[] {
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

/* ------------------------------------------------------------------ */
/*  Mini Calendar                                                      */
/* ------------------------------------------------------------------ */

interface MiniCalendarProps {
  today: Date;
  viewingYear: number;
  viewingMonth: number;
  postDates: Set<string>;
  onDateSelect: (date: Date) => void;
}

function MiniCalendar({ today, viewingYear, viewingMonth, postDates, onDateSelect }: MiniCalendarProps) {
  const [miniYear, setMiniYear] = useState(today.getFullYear());
  const [miniMonth, setMiniMonth] = useState(today.getMonth());

  const days = useMemo(() => getMiniCalDays(miniYear, miniMonth), [miniYear, miniMonth]);
  const todayKey = toDateKey(today);

  function prevMiniMonth() {
    if (miniMonth === 0) { setMiniMonth(11); setMiniYear(y => y - 1); }
    else setMiniMonth(m => m - 1);
  }
  function nextMiniMonth() {
    if (miniMonth === 11) { setMiniMonth(0); setMiniYear(y => y + 1); }
    else setMiniMonth(m => m + 1);
  }

  return (
    <div className="select-none">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={prevMiniMonth}
          className="p-1 rounded hover:bg-bg-tertiary text-ink3 hover:text-ink transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <span className="text-[12px] font-mono uppercase tracking-[0.08em] text-ink">
          {MONTH_NAMES[miniMonth].slice(0, 3)} {miniYear}
        </span>
        <button
          onClick={nextMiniMonth}
          className="p-1 rounded hover:bg-bg-tertiary text-ink3 hover:text-ink transition-colors"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 mb-1">
        {DAY_MINI.map((d, i) => (
          <div key={i} className="text-center text-[10px] font-mono text-ink3 py-0.5">
            {d}
          </div>
        ))}
      </div>

      {/* Date grid */}
      <div className="grid grid-cols-7 gap-y-0.5">
        {days.map((day, i) => {
          const key = toDateKey(day);
          const isToday = key === todayKey;
          const isCurrentMonth = day.getMonth() === miniMonth;
          const isViewing = day.getFullYear() === viewingYear && day.getMonth() === viewingMonth;
          const hasPost = postDates.has(key);

          return (
            <button
              key={i}
              onClick={() => onDateSelect(day)}
              className={`
                relative w-7 h-7 mx-auto rounded-full text-[11px] font-mono flex items-center justify-center
                transition-colors
                ${isToday ? 'bg-accent-primary text-white' : ''}
                ${!isToday && isViewing ? 'ring-1 ring-accent-primary' : ''}
                ${!isToday && isCurrentMonth ? 'text-ink hover:bg-bg-tertiary' : ''}
                ${!isToday && !isCurrentMonth ? 'text-ink3 hover:bg-bg-tertiary' : ''}
              `}
            >
              {day.getDate()}
              {hasPost && !isToday && (
                <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-accent-primary" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface CalendarSidebarProps {
  today: Date;
  currentYear: number;
  currentMonth: number;
  postDates: Set<string>;
  pillars: PillarInfo[];
  visiblePillars: Set<string>;
  onPillarToggle: (slug: string) => void;
  backlog: Post[];
  selectedPostId: string | null;
  onBacklogPostClick: (post: Post) => void;
  onDateSelect: (date: Date) => void;
  onCreateScheduled: () => void;
  onFillWeek: () => void;
  fillDisabled: boolean;
}

/* ------------------------------------------------------------------ */
/*  Sidebar                                                            */
/* ------------------------------------------------------------------ */

/**
 * Left sidebar modelled after Google Calendar:
 * mini-calendar, pillar filters, and draggable backlog.
 */
export default function CalendarSidebar({
  today,
  currentYear,
  currentMonth,
  postDates,
  pillars,
  visiblePillars,
  onPillarToggle,
  backlog,
  selectedPostId,
  onBacklogPostClick,
  onDateSelect,
  onCreateScheduled,
  onFillWeek,
  fillDisabled,
}: CalendarSidebarProps) {
  const [pillarsOpen, setPillarsOpen] = useState(true);
  const [backlogOpen, setBacklogOpen] = useState(true);

  return (
    <aside className="hidden lg:flex flex-col w-[260px] shrink-0 border-l border-hair bg-bg-secondary overflow-y-auto">
      <div className="p-4 space-y-5">

        {/* ── + Schedule Post ── */}
        <button
          onClick={onCreateScheduled}
          className="flex items-center gap-2 w-full px-4 py-2.5 bg-accent-primary text-white rounded-lg hover:opacity-90 transition-opacity text-[13px] font-medium shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Schedule Post
        </button>

        {/* ── Mini Calendar ── */}
        <MiniCalendar
          today={today}
          viewingYear={currentYear}
          viewingMonth={currentMonth}
          postDates={postDates}
          onDateSelect={onDateSelect}
        />

        {/* ── My Pillars ── */}
        {pillars.length > 0 && (
          <div>
            <button
              onClick={() => setPillarsOpen(o => !o)}
              className="flex items-center justify-between w-full mb-2 group"
            >
              <span className="text-[11px] font-mono uppercase tracking-[0.1em] text-ink3 group-hover:text-ink transition-colors">
                My Pillars
              </span>
              <ChevronRight
                className={`w-3.5 h-3.5 text-ink3 transition-transform ${pillarsOpen ? 'rotate-90' : ''}`}
              />
            </button>
            {pillarsOpen && (
              <div className="space-y-1">
                {pillars.map((p) => {
                  const visible = visiblePillars.has(p.value);
                  return (
                    <button
                      key={p.value}
                      onClick={() => onPillarToggle(p.value)}
                      className="flex items-center gap-2.5 w-full px-1 py-1 rounded-md hover:bg-bg-tertiary transition-colors text-left"
                    >
                      <span
                        className="w-3.5 h-3.5 rounded-[3px] border-2 shrink-0 transition-colors"
                        style={{
                          backgroundColor: visible ? p.color : 'transparent',
                          borderColor: p.color,
                        }}
                      />
                      <span className={`text-[13px] truncate ${visible ? 'text-ink' : 'text-ink3'}`}>
                        {p.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Backlog ── */}
        <div>
          <button
            onClick={() => setBacklogOpen(o => !o)}
            className="flex items-center justify-between w-full mb-2 group"
          >
            <span className="text-[11px] font-mono uppercase tracking-[0.1em] text-ink3 group-hover:text-ink transition-colors">
              Backlog {backlog.length > 0 && `(${backlog.length})`}
            </span>
            <ChevronRight
              className={`w-3.5 h-3.5 text-ink3 transition-transform ${backlogOpen ? 'rotate-90' : ''}`}
            />
          </button>

          {backlogOpen && (
            <>
              {/* AI Fill button */}
              <button
                onClick={onFillWeek}
                disabled={fillDisabled}
                className="flex items-center gap-1.5 w-full px-3 py-1.5 mb-2 text-[12px] font-medium border border-border rounded-md text-ink3 hover:text-ink hover:border-border-hover transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <Sparkles className="w-3.5 h-3.5 text-accent-primary" />
                AI Fill This Week
              </button>

              {backlog.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-4 text-center">
                  <CalendarDays className="w-5 h-5 text-ink3" />
                  <p className="text-[12px] text-text-secondary">No unscheduled posts.</p>
                </div>
              ) : (
                <Droppable droppableId="backlog" isDropDisabled>
                  {(provided) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className="space-y-1.5 max-h-[320px] overflow-y-auto pr-1"
                    >
                      {backlog.map((p, index) => (
                        <Draggable key={p.id} draggableId={p.id} index={index}>
                          {(dragProvided, dragSnapshot) => (
                            <div
                              ref={dragProvided.innerRef}
                              {...dragProvided.draggableProps}
                              {...dragProvided.dragHandleProps}
                              onClick={() => onBacklogPostClick(p)}
                              className={`rounded-lg border p-2.5 cursor-grab active:cursor-grabbing transition-colors ${
                                dragSnapshot.isDragging
                                  ? 'border-accent-primary bg-coral-light shadow-md rotate-1'
                                  : selectedPostId === p.id
                                  ? 'border-accent-primary bg-coral-light'
                                  : 'border-border bg-bg-secondary hover:border-border-hover'
                              }`}
                            >
                              <div className="flex items-center gap-1.5 mb-1">
                                {postPillars(p).map((pl) => (
                                  <PillarDot key={pl} pillar={pl} />
                                ))}
                                <span className="text-[12px] text-text-primary font-medium truncate flex-1">
                                  {p.title}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <StatusBadge status={p.status} />
                                <span className="text-[10px] font-mono text-ink3 uppercase tracking-[0.06em]">
                                  {p.platform}
                                </span>
                              </div>
                            </div>
                          )}
                        </Draggable>
                      ))}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              )}
            </>
          )}
        </div>
      </div>
    </aside>
  );
}
