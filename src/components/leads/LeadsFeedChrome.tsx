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
} from 'lucide-react';
import { Button } from '@/components/ui/Button';

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
      <HeaderBtn onClick={onOpenDrawer} icon={<SlidersHorizontal className="h-3.5 w-3.5" />}>
        Advanced
      </HeaderBtn>
      <Link href="/leads/settings" className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-md border border-border bg-bg-secondary hover:bg-bg-primary text-text-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary">
        <Settings className="h-3.5 w-3.5" /> Settings
      </Link>
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
      <h2 className="font-serif text-[20px] text-text-primary">No leads yet today</h2>
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
