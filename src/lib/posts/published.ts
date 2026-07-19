/**
 * The single definition of "this post actually went live".
 *
 * WHY this exists: `status = 'posted'` alone is not proof of publication. The
 * status column is user-editable (Library's status dropdown) and is also the
 * optimistic target of the publish queue, so a draft can carry it without ever
 * having reached a platform. Only `posted_date` is stamped by something that
 * observed a real publish - the publish job on success
 * (lib/publish-queue.ts), the metrics sync from the provider
 * (lib/analytics/sync-user-metrics.ts), the LinkedIn import, or the creator
 * explicitly logging when they posted it by hand.
 *
 * Every surface that says "published", "live", or "your latest post" must go
 * through here. Callers that trusted bare `status='posted'` ranked the most
 * recently *edited* row as the newest post, which surfaced drafts the creator
 * never published.
 */

/** A post row with the two fields that decide publication. */
export interface PublishablePost {
  status?: string | null;
  posted_date?: string | null;
}

/** True only when the post has genuinely been published. */
export function isPublished(post: PublishablePost): boolean {
  return post.status === 'posted' && Boolean(post.posted_date);
}

/**
 * Narrow a posts query to genuinely-published rows.
 *
 * Generic over the query builder so it composes with the InsForge SDK's
 * chained calls the same way the workspace scoping helpers do.
 */
export function onlyPublished<T>(query: T): T {
  const q = query as unknown as {
    eq: (col: string, val: string) => unknown;
    not: (col: string, op: string, val: null) => T;
  };
  return (q.eq('status', 'posted') as unknown as {
    not: (col: string, op: string, val: null) => T;
  }).not('posted_date', 'is', null);
}

/**
 * The instant a post went live, or null if it never did.
 *
 * Deliberately has no `updated_at` / `created_at` fallback: those describe when
 * a row was touched, not when it was published, and using them as a stand-in is
 * what let an edited draft outrank a real post when sorting for "latest".
 */
export function publishedAt(post: PublishablePost): string | null {
  return isPublished(post) ? (post.posted_date as string) : null;
}

/** Most recently published post, or null when none qualify. */
export function pickLatestPublished<T extends PublishablePost>(posts: T[]): T | null {
  let latest: T | null = null;
  for (const post of posts) {
    if (!isPublished(post)) continue;
    if (!latest || (post.posted_date as string) > (latest.posted_date as string)) {
      latest = post;
    }
  }
  return latest;
}
