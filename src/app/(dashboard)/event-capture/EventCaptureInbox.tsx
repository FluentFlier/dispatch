'use client';

import { CalendarDays, X } from 'lucide-react';
import type { CaptureStatus, CaptureSummary } from './useEventCapture';

/** Human-friendly labels for each capture status shown on the card. */
const STATUS_LABELS: Record<CaptureStatus, string> = {
  questions_ready: 'Needs answers',
  drafting: 'Drafting',
  drafted: 'Draft ready',
};

interface EventCaptureInboxProps {
  items: CaptureSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDismiss: (id: string) => void;
}

/**
 * Renders the event-capture inbox: one card per capture showing title, event
 * type, end date, and status. Clicking a card opens the detail panel via
 * onSelect; the X dismisses it. Empty state nudges the user to connect a
 * calendar. Styling mirrors the Signals inbox so the two feeds read alike.
 */
export function EventCaptureInbox({
  items,
  selectedId,
  onSelect,
  onDismiss,
}: EventCaptureInboxProps) {
  if (items.length === 0) {
    return (
      <div className="p-8 md:p-10 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-md bg-coral-light text-accent-primary mb-5">
          <CalendarDays className="h-7 w-7" strokeWidth={1.75} />
        </div>
        <h2 className="font-serif text-[20px] text-text-primary">No events yet</h2>
        <p className="mt-2 text-sm text-text-secondary max-w-sm mx-auto leading-relaxed">
          Connect a calendar in Settings. After you attend an event, it shows up
          here so you can turn it into a post.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border">
      {items.map((c) => {
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
                <span className="text-xs font-mono uppercase tracking-wide text-accent-primary">
                  {c.event_type}
                </span>
                <span className="text-xs text-text-tertiary shrink-0">
                  {new Date(c.end_time).toLocaleDateString()}
                </span>
              </div>
              <p className="mt-1 text-sm font-medium text-text-primary line-clamp-2">
                {c.title}
              </p>
              <p className="mt-0.5 text-xs text-text-tertiary">
                {STATUS_LABELS[c.status] ?? c.status}
              </p>
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
  );
}
