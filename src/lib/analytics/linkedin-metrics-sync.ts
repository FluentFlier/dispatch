import type { createClient } from '@insforge/sdk';
import { buildPostIdCandidates } from '@/lib/engagement/unipile-reactions';
import { fetchPostsFromUnipile, resolveUnipileTarget } from '@/lib/onboarding/import-posts';
import { hasPostMetrics, metricsPatchFromNormalized } from '@/lib/analytics/post-metrics';
import {
  extractLinkedInMetrics,
  extractLinkedInPublishedAt,
} from '@/lib/platforms/linkedin-metrics';
import { logError, logInfo } from '@/lib/logger';

type InsforgeClient = ReturnType<typeof createClient>;

export interface LinkedInSyncTarget {
  unipileAccountId: string;
  providerUserIds: string[];
}

interface LinkedInJobRow {
  post_id: string;
  provider_post_id: string;
}

/** Every id format we might see on publish_jobs vs Unipile list payloads. */
export function providerPostIdAliases(id: string): string[] {
  const keys = new Set<string>([id, ...buildPostIdCandidates(id)]);
  if (id.includes(':')) {
    const tail = id.split(':').filter(Boolean).at(-1);
    if (tail) keys.add(tail);
  }
  return [...keys];
}

export function indexLinkedInListMetrics(
  items: Array<Record<string, unknown>>,
): Map<string, Record<string, number>> {
  const index = new Map<string, Record<string, number>>();
  for (const item of items) {
    const id = typeof item.id === 'string' ? item.id : undefined;
    if (!id) continue;
    const patch = metricsPatchFromNormalized(extractLinkedInMetrics(item));
    if (Object.keys(patch).length === 0) continue;
    for (const key of providerPostIdAliases(id)) {
      if (!index.has(key)) index.set(key, patch);
    }
  }
  return index;
}

export function lookupMetricsPatch(
  index: Map<string, Record<string, number>>,
  providerPostId: string,
): Record<string, number> | undefined {
  for (const key of providerPostIdAliases(providerPostId)) {
    const patch = index.get(key);
    if (patch) return patch;
  }
  return undefined;
}

export function providerPostIdsMatch(a: string, b: string): boolean {
  const keys = new Set(providerPostIdAliases(a));
  return providerPostIdAliases(b).some((key) => keys.has(key));
}

/**
 * Resolves (and heals) the user's LinkedIn Unipile account. Works even when
 * unipile_account_id was never persisted but account_id (public identifier) was.
 */
export async function resolveLinkedInSyncTarget(
  client: InsforgeClient,
  userId: string,
): Promise<LinkedInSyncTarget | null> {
  const { data: account } = await client.database
    .from('social_accounts')
    .select('unipile_account_id, account_id')
    .eq('user_id', userId)
    .eq('platform', 'linkedin')
    .limit(1)
    .maybeSingle();

  const row = account as { unipile_account_id: string | null; account_id: string | null } | null;
  if (!row?.unipile_account_id && !row?.account_id) return null;

  const storedId = row.unipile_account_id ?? 'stale';
  try {
    const target = await resolveUnipileTarget(storedId, row.account_id, 'linkedin');
    if (!target?.unipileAccountId || target.providerUserIds.length === 0) return null;

    if (target.refreshed) {
      await client.database
        .from('social_accounts')
        .update({ unipile_account_id: target.unipileAccountId })
        .eq('user_id', userId)
        .eq('platform', 'linkedin');
      logInfo('[analytics-sync] Healed rotated Unipile account id', { userId });
    }

    return {
      unipileAccountId: target.unipileAccountId,
      providerUserIds: target.providerUserIds,
    };
  } catch (e) {
    logError('[analytics-sync] Unipile account resolve failed', { userId }, e);
    return null;
  }
}

/**
 * Bulk backfill from GET /users/{id}/posts — the same endpoint import uses.
 * List payloads include impression/reaction counters even when per-post GET is empty.
 */
export async function backfillLinkedInMetricsFromPostList(
  client: InsforgeClient,
  userId: string,
  target: LinkedInSyncTarget,
  jobs: LinkedInJobRow[],
  maxPosts = 60,
): Promise<number> {
  if (!process.env.UNIPILE_API_KEY || !process.env.UNIPILE_DSN || jobs.length === 0) {
    return 0;
  }

  let listResult;
  try {
    listResult = await fetchPostsFromUnipile(
      target.providerUserIds,
      target.unipileAccountId,
      'linkedin',
      maxPosts,
    );
  } catch (e) {
    logError('[analytics-sync] Unipile post list fetch failed', { userId }, e);
    return 0;
  }

  const metricsIndex = indexLinkedInListMetrics(
    listResult.rawItems as Array<Record<string, unknown>>,
  );
  if (metricsIndex.size === 0) return 0;

  let updated = 0;
  for (const job of jobs) {
    const patch = lookupMetricsPatch(metricsIndex, job.provider_post_id);
    if (!patch || Object.keys(patch).length === 0) continue;

    const { data: post } = await client.database
      .from('posts')
      .select('views, likes, saves, comments, shares')
      .eq('id', job.post_id)
      .eq('user_id', userId)
      .maybeSingle();

    if (post && hasPostMetrics(post as Parameters<typeof hasPostMetrics>[0])) {
      continue;
    }

    const listItem = listResult.rawItems.find(
      (item) => item.id && providerPostIdsMatch(item.id, job.provider_post_id),
    );
    const publishedAt = listItem ? extractLinkedInPublishedAt(listItem) : undefined;

    const postPatch: Record<string, string | number> = { ...patch };
    if (publishedAt) postPatch.posted_date = publishedAt.split('T')[0];

    const { error: updErr } = await client.database
      .from('posts')
      .update(postPatch)
      .eq('id', job.post_id)
      .eq('user_id', userId);

    if (updErr) {
      logError('[analytics-sync] list backfill update failed', { postId: job.post_id }, updErr);
      continue;
    }
    updated += 1;
  }

  if (updated > 0) {
    logInfo('[analytics-sync] LinkedIn list backfill updated posts', { userId, updated });
  }
  return updated;
}
