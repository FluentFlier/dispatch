'use client';

import { useCallback, useRef } from 'react';
import type { UnifiedLeadCard } from '@/lib/signals/feed/normalize';
import { LeadCard } from './LeadCard';

interface UnifiedFeedProps {
  cards: UnifiedLeadCard[];
  selectedId: string | null;
  loading: boolean;
  /** Dimmed (but not skeleton) while a background refetch is in flight. */
  refreshing?: boolean;
  onSelect: (id: string) => void;
  /** Tells the feed whether a given card is a followed company (drives the pin). */
  isFollowed: (card: UnifiedLeadCard) => boolean;
}

/** A single shimmer row shown while the first feed load is in flight. */
function SkeletonRow() {
  return (
    <div className="px-4 py-3 border-b border-border last:border-0">
      <div className="flex items-center justify-between">
        <div className="h-3.5 w-16 rounded bg-bg-tertiary animate-pulse" />
        <div className="h-3.5 w-8 rounded bg-bg-tertiary animate-pulse" />
      </div>
      <div className="h-4 w-40 rounded bg-bg-tertiary animate-pulse mt-2" />
      <div className="h-3 w-24 rounded bg-bg-tertiary animate-pulse mt-2" />
    </div>
  );
}

/**
 * The scrollable list half of the unified leads feed. Renders `LeadCard`s for
 * an already-sorted list of unified cards, shows skeleton rows on first load,
 * and owns roving arrow-key navigation (Up/Down move focus and selection,
 * Home/End jump to the ends) so the list is fully keyboard-operable. The empty
 * state is intentionally NOT rendered here; the page owns it so it can offer the
 * "Scrape now" call to action with its own handler.
 */
export function UnifiedFeed({
  cards,
  selectedId,
  loading,
  refreshing,
  onSelect,
  isFollowed,
}: UnifiedFeedProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Roving keyboard navigation: move focus + selection between rows.
  const handleKeyDown = useCallback(
    (index: number) => (e: React.KeyboardEvent<HTMLButtonElement>) => {
      const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]');
      if (!buttons || buttons.length === 0) return;
      let next = -1;
      if (e.key === 'ArrowDown') next = Math.min(index + 1, buttons.length - 1);
      else if (e.key === 'ArrowUp') next = Math.max(index - 1, 0);
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = buttons.length - 1;
      if (next === -1) return;
      e.preventDefault();
      buttons[next].focus();
      const id = cards[next]?.id;
      if (id) onSelect(id);
    },
    [cards, onSelect],
  );

  if (loading) {
    return (
      <div className="border border-border rounded-lg bg-bg-secondary overflow-hidden" aria-busy="true">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonRow key={i} />
        ))}
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Leads feed"
      aria-activedescendant={selectedId ?? undefined}
      className={`border border-border rounded-lg bg-bg-secondary overflow-hidden transition-opacity ${
        refreshing ? 'opacity-60' : ''
      }`}
    >
      {cards.map((card, i) => (
        <LeadCard
          key={card.id}
          card={card}
          selected={selectedId === card.id}
          followed={isFollowed(card)}
          onSelect={() => onSelect(card.id)}
          onKeyDown={handleKeyDown(i)}
        />
      ))}
    </div>
  );
}
