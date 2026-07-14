'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  Download,
  FileDown,
  RefreshCw,
  Settings,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';

/**
 * Live scrape progress: a labeled determinate bar driven by the NDJSON stream
 * from /api/leads/sync. `pct` is 0-100. `panel` renders the big centered
 * variant used in place of the empty state on a first scrape; the default is a
 * slim inline bar shown above an already-populated feed.
 */
export function ScrapeProgress({
  pct,
  label,
  panel = false,
}: {
  pct: number;
  label: string;
  panel?: boolean;
}) {
  const clamped = Math.min(100, Math.max(0, Math.round(pct)));
  const bar = (
    <div className="w-full">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-medium text-text-secondary flex items-center gap-1.5 min-w-0">
          <Download className="h-3.5 w-3.5 shrink-0 animate-pulse" aria-hidden="true" />
          <span className="truncate">{label}</span>
        </span>
        <span className="text-xs font-medium text-text-tertiary tabular-nums shrink-0 ml-2">{clamped}%</span>
      </div>
      <div
        className="h-1.5 w-full rounded-full bg-bg-tertiary overflow-hidden"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Scrape progress"
      >
        <div
          className="h-full rounded-full bg-accent-primary transition-all duration-500 ease-out"
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
  if (!panel) {
    return <div className="rounded-lg border border-border bg-bg-secondary px-4 py-3">{bar}</div>;
  }
  return (
    <div className="flex flex-col items-center justify-center text-center min-h-[360px] gap-3">
      <p className="text-sm font-medium text-text-primary">Scraping fresh leads…</p>
      <p className="text-xs text-text-secondary max-w-sm">
        This can take a minute or two. We&apos;re pulling directories, finding contacts, and scoring
        fit for your ICP.
      </p>
      <div className="w-full max-w-md mt-1">{bar}</div>
    </div>
  );
}

/**
 * Small pill button used across the leads feed header (Scrape, Draft all,
 * Refresh, Advanced). Extracted from the page so the page file stays focused on
 * state and data flow and comfortably under the 500-line limit.
 */
export function HeaderBtn({
  onClick,
  disabled,
  icon,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-md border border-border bg-bg-secondary hover:bg-bg-primary text-text-secondary disabled:opacity-50 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary"
    >
      {icon}
      {children}
    </button>
  );
}

/**
 * Header action cluster for the leads page. In the Feed view it exposes the
 * scrape / draft-all / refresh / advanced / settings controls; in the Setup view
 * it collapses to a single "Directory config" button that opens the same drawer.
 * Kept out of the page so the page file stays under the 500-line limit.
 */
export function LeadsHeaderActions({
  view,
  scraping,
  listLoading,
  draftAll,
  onScrape,
  onDraftAll,
  onRefresh,
  onOpenDrawer,
  onExport,
  onImport,
}: {
  view: 'feed' | 'setup';
  scraping: boolean;
  listLoading: boolean;
  draftAll: { done: number; total: number } | null;
  onScrape: () => void;
  onDraftAll: () => void;
  onRefresh: () => void;
  onOpenDrawer: () => void;
  onExport: () => void;
  onImport: () => void;
}) {
  if (view !== 'feed') {
    return (
      <HeaderBtn onClick={onOpenDrawer} icon={<SlidersHorizontal className="h-3.5 w-3.5" />}>
        Directory config
      </HeaderBtn>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <HeaderBtn onClick={onScrape} disabled={scraping} icon={<Download className={`h-3.5 w-3.5 ${scraping ? 'animate-pulse' : ''}`} />}>
        {scraping ? 'Scraping…' : 'Scrape now'}
      </HeaderBtn>
      <HeaderBtn onClick={onDraftAll} disabled={draftAll !== null} icon={<Sparkles className={`h-3.5 w-3.5 ${draftAll ? 'animate-pulse' : ''}`} />}>
        {draftAll ? `Drafting ${draftAll.done}/${draftAll.total}…` : 'Draft all'}
      </HeaderBtn>
      <HeaderBtn onClick={onRefresh} disabled={listLoading} icon={<RefreshCw className={`h-3.5 w-3.5 ${listLoading ? 'animate-spin' : ''}`} />}>
        Refresh
      </HeaderBtn>
      <HeaderBtn onClick={onExport} icon={<FileDown className="h-3.5 w-3.5" />}>
        Export CSV
      </HeaderBtn>
      <HeaderBtn onClick={onImport} icon={<Upload className="h-3.5 w-3.5" />}>
        Import
      </HeaderBtn>
      <HeaderBtn onClick={onOpenDrawer} icon={<SlidersHorizontal className="h-3.5 w-3.5" />}>
        Advanced
      </HeaderBtn>
      <Link href="/leads/settings" className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-md border border-border bg-bg-secondary hover:bg-bg-primary text-text-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary">
        <Settings className="h-3.5 w-3.5" /> Settings
      </Link>
    </div>
  );
}

/**
 * Empty state shown when the feed has leads but the ACTIVE FILTERS exclude them
 * all - distinct from `LeadsEmptyState` (no leads at all). Offers a one-click
 * clear, and when a signal-type filter is the culprit, explains that
 * funding / role-change / accelerator signals come from the live Signal engine
 * (X/LinkedIn detection), not the directory scrape - so those can be legitimately
 * empty until the engine is configured.
 */
export function LeadsFilteredEmptyState({
  onClear,
  signalHint,
}: {
  onClear: () => void;
  signalHint: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center min-h-[360px] gap-3">
      <div className="p-3 rounded-lg bg-bg-tertiary">
        <SlidersHorizontal className="h-6 w-6 text-text-secondary" aria-hidden="true" />
      </div>
      <h2 className="text-[20px] text-text-primary">No leads match these filters</h2>
      <p className="text-sm text-text-secondary max-w-md">
        {signalHint
          ? 'Funding, new-role, and accelerator signals are detected from live X / LinkedIn posts by the Signal engine - the directory scrape only surfaces companies and launches. Configure the Signal engine in Setup, or clear the filter to see your scraped leads.'
          : 'Your scraped leads don’t match the current filters. Clear them to see everything.'}
      </p>
      <div className="flex gap-2 mt-1">
        <Button variant="primary" size="sm" onClick={onClear}>
          Clear filters
        </Button>
        <Link href="/leads?view=setup">
          <Button variant="secondary" size="sm">
            Open Setup
          </Button>
        </Link>
      </div>
    </div>
  );
}

/** Empty state shown when the feed has no cards for the active filters. */
export function LeadsEmptyState({ onScrape, scraping }: { onScrape: () => void; scraping: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center text-center min-h-[360px] gap-3">
      <div className="p-3 rounded-lg bg-coral-light">
        <TrendingUp className="h-6 w-6 text-accent-primary" />
      </div>
      <h2 className="text-[20px] text-text-primary">No leads yet today</h2>
      <p className="text-sm text-text-secondary max-w-sm">
        Scrape the directories now, or your next batch lands at your configured digest hour. Tune
        sources and ICP in Advanced.
      </p>
      <div className="flex gap-2 mt-1">
        <Button variant="primary" size="sm" onClick={onScrape} loading={scraping}>
          Scrape now
        </Button>
        <Link href="/leads/settings">
          <Button variant="secondary" size="sm">
            Open settings
          </Button>
        </Link>
      </div>
    </div>
  );
}
