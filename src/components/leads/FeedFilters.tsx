'use client';

import { useState } from 'react';
import { Search, ArrowUpDown, SlidersHorizontal } from 'lucide-react';
import type { LeadStatus, SignalType } from '@/lib/signals/types';

/** Sort orders the feed list supports. */
export type FeedSort = 'score' | 'recency';

/** Every filter the feed UI can drive. `status`/`source`/`signalType` map to feed query params; the rest are client-side. */
export interface FeedFilterState {
  status: LeadStatus | 'needs_reply' | 'all';
  source: string;
  signalType: SignalType | 'all';
  vertical: string;
  search: string;
  sort: FeedSort;
}

const STATUS_OPTIONS: Array<{ key: LeadStatus | 'needs_reply' | 'all'; label: string }> = [
  { key: 'all', label: 'All statuses' },
  { key: 'needs_reply', label: 'Needs reply' },
  { key: 'new', label: 'New' },
  { key: 'drafted', label: 'Drafted' },
  { key: 'approved', label: 'Approved' },
  { key: 'sent', label: 'Sent' },
  { key: 'dismissed', label: 'Dismissed' },
];

const SOURCE_OPTIONS: Array<{ key: string; label: string }> = [
  { key: 'all', label: 'All sources' },
  { key: 'manual', label: 'Imported' },
  { key: 'x', label: 'X (live)' },
  { key: 'linkedin', label: 'LinkedIn (live)' },
  { key: 'web_discovery', label: 'Web discovery' },
  { key: 'yc_directory', label: 'YC directory' },
  { key: 'yc_launches', label: 'YC launches' },
  { key: 'product_hunt', label: 'Product Hunt' },
];

const SIGNAL_OPTIONS: Array<{ key: SignalType | 'all'; label: string }> = [
  { key: 'all', label: 'All signals' },
  { key: 'accelerator_join', label: 'Joined accelerator' },
  { key: 'funding_round', label: 'Raised funding' },
  { key: 'role_change', label: 'New role' },
  { key: 'launch', label: 'Launched' },
  { key: 'keyword_match', label: 'Posted about topic' },
];

interface FeedFiltersProps {
  state: FeedFilterState;
  onChange: (next: FeedFilterState) => void;
  /** ICP verticals from settings, offered as a client-side quick filter. */
  verticals: string[];
}

const selectCls =
  'rounded-md border border-border bg-bg-secondary px-2.5 py-1.5 text-xs text-text-secondary cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary';

/**
 * The feed's control bar: a status segmented row, source/signal/ICP-vertical
 * selects, a search box, and a score/recency sort toggle. Status, source, and
 * signal type drive the `/api/leads/feed` query; vertical, search, and sort are
 * applied client-side. Everything is a native form control so keyboard users
 * and screen readers get correct semantics for free; each control carries an
 * explicit label.
 */
export function FeedFilters({ state, onChange, verticals }: FeedFiltersProps) {
  const set = (patch: Partial<FeedFilterState>) => onChange({ ...state, ...patch });

  // Advanced filters start hidden so the feed reads as "status + search" by
  // default. A count keeps any active-but-hidden filter visible at a glance.
  const advancedCount =
    (state.source !== 'all' ? 1 : 0) +
    (state.signalType !== 'all' ? 1 : 0) +
    (state.vertical !== 'all' ? 1 : 0) +
    (state.sort !== 'score' ? 1 : 0);
  const [showAdvanced, setShowAdvanced] = useState(advancedCount > 0);

  return (
    <div className="space-y-3">
      {/* Status segmented row */}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by status">
        {STATUS_OPTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            aria-pressed={state.status === s.key}
            onClick={() => set({ status: s.key })}
            className={`px-3 py-1.5 rounded-md text-sm font-medium cursor-pointer transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary ${
              state.status === s.key
                ? 'bg-accent-primary text-text-inverse'
                : 'bg-bg-secondary text-text-secondary hover:text-text-primary'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Search + "Filters" disclosure — the two controls people reach for most. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[160px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-tertiary" aria-hidden="true" />
          <label className="sr-only" htmlFor="feed-search">Search companies</label>
          <input
            id="feed-search"
            type="search"
            value={state.search}
            onChange={(e) => set({ search: e.target.value })}
            placeholder="Search company or tagline"
            className="w-full rounded-md border border-border bg-bg-secondary pl-8 pr-3 py-1.5 text-xs text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
          />
        </div>

        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          aria-expanded={showAdvanced}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-secondary px-2.5 py-1.5 text-xs text-text-secondary cursor-pointer hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          Filters
          {advancedCount > 0 && (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent-primary px-1 text-[10px] font-medium text-text-inverse">
              {advancedCount}
            </span>
          )}
        </button>
      </div>

      {/* Advanced filters — source / signal / vertical / sort, hidden by default. */}
      {showAdvanced && (
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="feed-source">Source</label>
          <select
            id="feed-source"
            value={state.source}
            onChange={(e) => set({ source: e.target.value })}
            className={selectCls}
          >
            {SOURCE_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>

          <label className="sr-only" htmlFor="feed-signal">Signal type</label>
          <select
            id="feed-signal"
            value={state.signalType}
            onChange={(e) => set({ signalType: e.target.value as SignalType | 'all' })}
            className={selectCls}
          >
            {SIGNAL_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>

          {verticals.length > 0 && (
            <>
              <label className="sr-only" htmlFor="feed-vertical">ICP vertical</label>
              <select
                id="feed-vertical"
                value={state.vertical}
                onChange={(e) => set({ vertical: e.target.value })}
                className={selectCls}
              >
                <option value="all">All verticals</option>
                {verticals.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </>
          )}

          {/* Sort toggle: score / recency */}
          <button
            type="button"
            onClick={() => set({ sort: state.sort === 'score' ? 'recency' : 'score' })}
            aria-label={`Sort by ${state.sort}, click to change`}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-secondary px-2.5 py-1.5 text-xs text-text-secondary cursor-pointer hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
          >
            <ArrowUpDown className="h-3.5 w-3.5" aria-hidden="true" />
            {state.sort === 'score' ? 'Score' : 'Recent'}
          </button>
        </div>
      )}
    </div>
  );
}
