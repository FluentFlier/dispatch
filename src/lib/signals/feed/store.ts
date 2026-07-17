/**
 * Unified feed store.
 *
 * The Leads feed presents two very different data sources (real-time signal
 * events and directory leads) as one list. This module owns loading both
 * sources for a workspace, normalizing them into `UnifiedLeadCard`s (Task 5),
 * and merging/sorting/filtering them into the single list the feed endpoint
 * returns. The merge/sort/filter step is kept pure and DB-free so it can be
 * unit-tested without mocking the database.
 */

import type { createClient } from '@insforge/sdk';
import { listLeads } from '@/lib/signals/leads/store';
import { listEventsWithPosts } from '@/lib/signals/store';
import { normalizeEvent, normalizeLead, type UnifiedLeadCard } from '@/lib/signals/feed/normalize';
import type { LeadStatus } from '@/lib/signals/types';

type InsforgeClient = ReturnType<typeof createClient>;

/** Shared page size for the unified feed, applied to both sources and the merged result. */
export const FEED_PAGE_LIMIT = 200;

/** Query filters accepted by the unified feed. `status: 'all'` disables the status filter. */
export interface FeedFilters {
  status?: string;
  source?: string;
  kind?: 'signal' | 'directory' | 'engager';
  signalType?: string;
  needsReply?: boolean;
  limit?: number;
}

/**
 * Merges already-normalized directory and signal cards into one list, applies
 * the requested filters, sorts by score (desc) then recency (desc), and caps
 * the result to the page limit (default `FEED_PAGE_LIMIT`). Merging two lists
 * of N cards can yield up to 2N cards, so the cap is applied after sort/filter
 * to keep the top-scored slice. Pure and DB-free so callers (and tests) don't
 * need to touch the database to exercise the feed's ordering/filtering
 * behavior.
 */
export function mergeFeed(
  directoryCards: UnifiedLeadCard[],
  signalCards: UnifiedLeadCard[],
  filters: FeedFilters,
): UnifiedLeadCard[] {
  let cards = [...directoryCards, ...signalCards];
  // Snoozed leads stay hidden until the snooze expires (listLeads filters too;
  // this keeps the pure merge correct for any caller).
  cards = cards.filter((c) => !c.snoozedUntil || Date.parse(c.snoozedUntil) <= Date.now());
  if (filters.kind) cards = cards.filter((c) => c.kind === filters.kind);
  if (filters.source) cards = cards.filter((c) => c.source === filters.source);
  if (filters.signalType) cards = cards.filter((c) => c.signalType === filters.signalType);
  if (filters.status && filters.status !== 'all') {
    cards = cards.filter((c) => c.status === filters.status);
  }
  const sorted = cards.sort((a, b) =>
    b.score - a.score || Date.parse(b.detectedAt) - Date.parse(a.detectedAt));
  const limit = filters.limit ?? FEED_PAGE_LIMIT;
  return sorted.slice(0, limit);
}

/**
 * Loads both lead sources for a workspace, normalizes each into unified
 * cards, and merges them into the single sorted/filtered feed list. This is
 * the entry point the `/api/leads/feed` route calls; RLS enforces workspace
 * isolation at the DB layer as well, so `workspaceId` scoping here is
 * belt-and-suspenders, not the only guard.
 */
export async function buildUnifiedFeed(
  client: InsforgeClient,
  workspaceId: string,
  filters: FeedFilters = {},
): Promise<UnifiedLeadCard[]> {
  const limit = Math.min(Math.max(filters.limit ?? FEED_PAGE_LIMIT, 1), 300);
  const needsReply = filters.needsReply ?? filters.status === 'needs_reply';
  const leadStatus =
    filters.status && filters.status !== 'all' && filters.status !== 'needs_reply'
      ? (filters.status as LeadStatus)
      : undefined;

  const [leads, events] = await Promise.all([
    listLeads(client, workspaceId, { limit, status: leadStatus, needsReply: needsReply || undefined }),
    listEventsWithPosts(client, workspaceId, { limit }),
  ]);
  let cards = mergeFeed(leads.map(normalizeLead), events.map(normalizeEvent), { ...filters, limit });
  if (needsReply) {
    cards = cards.filter((c) => c.needsReply || c.nurtureStage === 'replied');
  }
  return cards;
}
