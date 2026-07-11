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

/**
 * Read the first usable count. LinkedIn/Unipile often return `0` for
 * impressions/followers when the metric is hidden — treat bare zeros as
 * "missing" so we never overwrite real engagement with a fake zero view count.
 */
function readCount(...values: unknown[]): number | undefined {
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
    if (Array.isArray(v)) {
      let sum = 0;
      for (const item of v) {
        if (item && typeof item === 'object' && 'count' in item) {
          const c = (item as { count?: unknown }).count;
          if (typeof c === 'number' && Number.isFinite(c) && c >= 0) sum += c;
        }
      }
      if (sum > 0) return sum;
    }
  }
  return undefined;
}

/** ISO publish timestamp from a Unipile post payload (list or GET). */
export function extractLinkedInPublishedAt(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const root = payload as Record<string, unknown>;
  for (const key of ['parsed_datetime', 'created_at', 'date']) {
    const v = root[key];
    if (typeof v === 'string' && !Number.isNaN(new Date(v).getTime())) return v;
  }
  return undefined;
}

export interface LinkedInPostDetails {
  metrics: NormalizedMetrics;
  publishedAt?: string;
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
    // Unipile v1 uses flat *_counter + analytics.impressions; v2 renames to
    // analytics.impressions_counter / reactions_counter / comments_counter.
    views: readCount(
      analytics.impressions,
      analytics.impressions_counter,
      analytics.users_reached_counter,
      root.impressions_counter,
      root.views_count,
    ),
    likes: readCount(
      analytics.reactions,
      analytics.reactions_counter,
      root.reaction_counter,
      root.reactions_counter,
      root.like_count,
    ),
    comments: readCount(
      analytics.comments,
      analytics.comments_counter,
      root.comment_counter,
      root.comments_counter,
      root.comments_count,
    ),
    // Reposts are the closest analogue to "shares" (v2 typo: resposts_counter).
    shares: readCount(
      analytics.reposts,
      analytics.reposts_counter,
      root.repost_counter,
      root.reposts_counter,
      root.reposts_count,
      root.resposts_counter,
    ),
    follows: readCount(
      analytics.followers_gained_from_this_post,
      analytics.followers_gained_from_this_post_counter,
      root.followers_gained_from_this_post,
    ),
  };
}

/**
 * Fetches metrics + publish timestamp for a LinkedIn post through Unipile.
 */
export async function fetchLinkedInPostDetails(
  unipileAccountId: string,
  providerPostId: string,
): Promise<LinkedInPostDetails> {
  const dsn = process.env.UNIPILE_DSN;
  const key = process.env.UNIPILE_API_KEY;
  if (!dsn || !key) return { metrics: {} };

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
      const json = await res.json();
      return {
        metrics: extractLinkedInMetrics(json),
        publishedAt: extractLinkedInPublishedAt(json),
      };
    } catch (error) {
      if (error instanceof HttpStatusError && (error.status === 404 || error.status === 422)) {
        continue;
      }
      throw error;
    }
  }
  return { metrics: {} };
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
  const { metrics } = await fetchLinkedInPostDetails(unipileAccountId, providerPostId);
  return metrics;
}
