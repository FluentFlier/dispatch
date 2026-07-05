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

type InsforgeClient = ReturnType<typeof createClient>;

/** Query filters accepted by the unified feed. `status: 'all'` disables the status filter. */
export interface FeedFilters {
  status?: string;
  source?: string;
  kind?: 'signal' | 'directory';
  signalType?: string;
}

/**
 * Merges already-normalized directory and signal cards into one list, applies
 * the requested filters, and sorts by score (desc) then recency (desc). Pure
 * and DB-free so callers (and tests) don't need to touch the database to
 * exercise the feed's ordering/filtering behavior.
 */
export function mergeFeed(
  directoryCards: UnifiedLeadCard[],
  signalCards: UnifiedLeadCard[],
  filters: FeedFilters,
): UnifiedLeadCard[] {
  let cards = [...directoryCards, ...signalCards];
  if (filters.kind) cards = cards.filter((c) => c.kind === filters.kind);
  if (filters.source) cards = cards.filter((c) => c.source === filters.source);
  if (filters.signalType) cards = cards.filter((c) => c.signalType === filters.signalType);
  if (filters.status && filters.status !== 'all') {
    cards = cards.filter((c) => c.status === filters.status);
  }
  return cards.sort((a, b) =>
    b.score - a.score || Date.parse(b.detectedAt) - Date.parse(a.detectedAt));
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
  const [leads, events] = await Promise.all([
    listLeads(client, workspaceId),
    listEventsWithPosts(client, workspaceId),
  ]);
  return mergeFeed(leads.map(normalizeLead), events.map(normalizeEvent), filters);
}
