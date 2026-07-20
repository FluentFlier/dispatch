import type { UnifiedLeadCard } from '@/lib/signals/feed/normalize';

/** 'score' is best-ICP-fit first, 'warm' is reply/sequence urgency first. */
export type FeedSort = 'score' | 'warm' | 'recency';

function newestFirst(a: UnifiedLeadCard, b: UnifiedLeadCard): number {
  return Date.parse(b.detectedAt) - Date.parse(a.detectedAt);
}

/**
 * Sorts by the user's chosen intent without mixing fit, warmth, and recency.
 *
 * `score` carries the warm-feed boost baked in, so sorting on it made a warm
 * lukewarm-ICP lead outrank a cold strong-ICP one under a control labelled
 * "Best fit". Fit sorting reads `fitScore`; warmth sorting reads `urgencyScore`
 * and only falls back to fit as a tiebreak.
 */
export function compareFeedCards(a: UnifiedLeadCard, b: UnifiedLeadCard, sort: FeedSort): number {
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
