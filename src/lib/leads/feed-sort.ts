import type { UnifiedLeadCard } from '@/lib/signals/feed/normalize';

export type FeedSortMode = 'score' | 'warm' | 'recency';

function newestFirst(a: UnifiedLeadCard, b: UnifiedLeadCard): number {
  return Date.parse(b.detectedAt) - Date.parse(a.detectedAt);
}

/** Sorts by the user's chosen intent without mixing fit, warmth, and recency. */
export function compareFeedCards(a: UnifiedLeadCard, b: UnifiedLeadCard, sort: FeedSortMode): number {
  if (sort === 'recency') return newestFirst(a, b);
  if (sort === 'warm') {
    return (
      (b.urgencyScore ?? 0) - (a.urgencyScore ?? 0) ||
      (b.reachabilityScore ?? 0) - (a.reachabilityScore ?? 0) ||
      (b.fitScore ?? b.score) - (a.fitScore ?? a.score) ||
      newestFirst(a, b)
    );
  }
  return (b.fitScore ?? b.score) - (a.fitScore ?? a.score) || b.score - a.score || newestFirst(a, b);
}
