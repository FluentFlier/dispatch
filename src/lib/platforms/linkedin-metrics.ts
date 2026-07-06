/**
 * LinkedIn post metrics via Unipile GET /posts/{id}.
 *
 * LinkedIn's official API doesn't expose post metrics to third-party apps,
 * but Unipile does: impressions, reactions, comments, and reposts, spread
 * across an `analytics` object and/or flat `*_counter` fields depending on
 * post age and API version.
 */
import type { NormalizedMetrics } from '@/lib/platforms/twitter-metrics';
import { HttpStatusError, retryWithBackoff, throwIfNotOk } from '@/lib/social/reliability';
import { buildPostIdCandidates } from '@/lib/engagement/unipile-reactions';

function readCount(...values: unknown[]): number | undefined {
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v;
  }
  return undefined;
}

/**
 * Maps a Unipile post payload onto NormalizedMetrics, preferring the
 * `analytics` object and falling back to flat counter fields. Fields Unipile
 * didn't return stay undefined so callers never zero-out stored values —
 * same contract as the X/Instagram fetchers.
 */
export function extractLinkedInMetrics(payload: unknown): NormalizedMetrics {
  if (!payload || typeof payload !== 'object') return {};
  const root = payload as Record<string, unknown>;
  const analytics = (root.analytics ?? {}) as Record<string, unknown>;

  return {
    // LinkedIn "impressions" are our normalized "views".
    views: readCount(analytics.impressions, root.impressions_counter, root.views_count),
    likes: readCount(analytics.reactions, root.reaction_counter, root.like_count),
    comments: readCount(analytics.comments, root.comment_counter, root.comments_count),
    // Reposts are the closest analogue to "shares".
    shares: readCount(analytics.reposts, root.repost_counter, root.reposts_count),
  };
}

/**
 * Fetches metrics for a published LinkedIn post through the user's connected
 * Unipile account, trying each known post-id format (activity/share/ugcPost
 * URNs) until one resolves. Returns {} when the post can't be found so a
 * deleted post never fails the whole metrics-sync batch.
 */
export async function fetchLinkedInMetrics(
  unipileAccountId: string,
  providerPostId: string,
): Promise<NormalizedMetrics> {
  const dsn = process.env.UNIPILE_DSN;
  const key = process.env.UNIPILE_API_KEY;
  if (!dsn || !key) return {};

  const base = `https://${dsn.replace(/\/$/, '')}/api/v1`;

  for (const candidate of buildPostIdCandidates(providerPostId)) {
    try {
      const res = await retryWithBackoff(async () =>
        throwIfNotOk(
          await fetch(
            `${base}/posts/${encodeURIComponent(candidate)}?account_id=${encodeURIComponent(unipileAccountId)}`,
            { headers: { 'X-API-KEY': key, accept: 'application/json' } },
          ),
          'Unipile get post',
        ),
      );
      return extractLinkedInMetrics(await res.json());
    } catch (error) {
      if (error instanceof HttpStatusError && (error.status === 404 || error.status === 422)) {
        continue; // wrong id format — try the next candidate
      }
      throw error;
    }
  }
  return {};
}
