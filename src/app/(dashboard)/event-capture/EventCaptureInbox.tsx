'use client';

import { useMemo, useState } from 'react';
import { CalendarDays, Search, X } from 'lucide-react';
import type { CaptureStatus, CaptureSummary } from './useEventCapture';

/** Human-friendly labels for each capture status shown on the card. */
const STATUS_LABELS: Record<CaptureStatus, string> = {
  questions_ready: 'Needs answers',
  drafting: 'Drafting',
  drafted: 'Draft ready',
};

/** Badge colors per status, so the eye can scan for "needs answers" without reading text. */
const STATUS_BADGE_CLS: Record<CaptureStatus, string> = {
  questions_ready: 'bg-amber-50 text-amber-700',
  drafting: 'bg-blue-50 text-blue-700',
  drafted: 'bg-green-50 text-green-700',
};

/** Status quick-filter tabs. 'answered' covers both drafting and drafted. */
type StatusFilter = 'all' | 'questions_ready' | 'answered';

const STATUS_TABS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'questions_ready', label: 'Needs answers' },
  { key: 'answered', label: 'Answered' },
];

type SortKey = 'newest' | 'oldest' | 'title';

const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: 'newest', label: 'Newest first' },
  { key: 'oldest', label: 'Oldest first' },
  { key: 'title', label: 'Title A-Z' },
];

interface EventCaptureInboxProps {
  items: CaptureSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDismiss: (id: string) => void;
}

/**
 * Renders the event-capture inbox: a search + status-filter + sort control bar,
 * then one card per capture showing title, event type, full date/time, and a
 * color-coded status badge. Clicking a card opens the detail panel via onSelect;
 * the X dismisses it. Empty state nudges the user to connect a calendar. Styling
 * mirrors the Signals inbox so the two feeds read alike.
 */
export function EventCaptureInbox({
  items,
  selectedId,
  onSelect,
  onDismiss,
}: EventCaptureInboxProps) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<SortKey>('newest');

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();

    const filtered = items.filter((c) => {
      if (term && !c.title.toLowerCase().includes(term) && !c.event_type.toLowerCase().includes(term)) {
        return false;
      }
      if (statusFilter === 'questions_ready') return c.status === 'questions_ready';
      if (statusFilter === 'answered') return c.status === 'drafting' || c.status === 'drafted';
      return true;
    });

    return filtered.slice().sort((a, b) => {
      if (sort === 'oldest') return Date.parse(a.end_time) - Date.parse(b.end_time);
      if (sort === 'title') return a.title.localeCompare(b.title);
      return Date.parse(b.end_time) - Date.parse(a.end_time);
    });
  }, [items, search, statusFilter, sort]);

  if (items.length === 0) {
    return (
      <div className="p-8 md:p-10 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-md bg-coral-light text-accent-primary mb-5">
          <CalendarDays className="h-7 w-7" strokeWidth={1.75} />
        </div>
        <h2 className="text-[20px] text-text-primary">No events yet</h2>
        <p className="mt-2 text-sm text-text-secondary max-w-sm mx-auto leading-relaxed">
          Connect a calendar in Settings. After you attend an event, it shows up
          here so you can turn it into a post.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="px-3 py-2.5 border-b border-border space-y-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-tertiary" aria-hidden="true" />
          <label className="sr-only" htmlFor="event-search">Search events</label>
          <input
            id="event-search"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search events"
            className="w-full rounded-md border border-border bg-bg-secondary pl-8 pr-3 py-1.5 text-xs text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by status">
            {STATUS_TABS.map((s) => (
              <button
                key={s.key}
                type="button"
                aria-pressed={statusFilter === s.key}
                onClick={() => setStatusFilter(s.key)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary ${
                  statusFilter === s.key
                    ? 'bg-accent-primary text-text-inverse'
                    : 'bg-bg-secondary text-text-secondary hover:text-text-primary'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <label className="sr-only" htmlFor="event-sort">Sort</label>
          <select
            id="event-sort"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-md border border-border bg-bg-secondary px-2 py-1 text-xs text-text-secondary cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="p-4 text-sm text-text-tertiary">No events match your search or filter.</p>
      ) : (
        <ul className="divide-y divide-border">
          {visible.map((c) => {
            const active = selectedId === c.id;
            return (
              <li
                key={c.id}
                className={`flex items-start justify-between gap-2 transition-colors hover:bg-bg-primary ${
                  active ? 'bg-bg-primary border-l-2 border-accent-primary' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelect(c.id)}
                  className="flex-1 text-left px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs tracking-wide text-accent-primary">
                      {c.event_type}
                    </span>
                    <span className="text-xs text-text-tertiary shrink-0">
                      {new Date(c.end_time).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}{' '}
                      {new Date(c.end_time).toLocaleTimeString(undefined, {
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                  <p className="mt-1 text-sm font-medium text-text-primary line-clamp-2">
                    {c.title}
                  </p>
                  <span
                    className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_BADGE_CLS[c.status] ?? 'bg-bg-tertiary text-text-tertiary'}`}
                  >
                    {STATUS_LABELS[c.status] ?? c.status}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onDismiss(c.id)}
                  className="mt-3 mr-3 p-1.5 rounded-md text-text-tertiary hover:bg-bg-secondary hover:text-text-primary"
                  aria-label="Dismiss event"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
