import type { createClient } from '@insforge/sdk';
import { decryptToken } from '@/lib/crypto';
import { metricsPatchFromNormalized } from '@/lib/analytics/post-metrics';
import { fetchLinkedInPostDetails } from '@/lib/platforms/linkedin-metrics';
import { fetchTweetMetrics } from '@/lib/platforms/twitter-metrics';
import { fetchInstagramMetrics } from '@/lib/platforms/instagram-metrics';
import {
  backfillLinkedInMetricsFromPostList,
  resolveLinkedInSyncTarget,
} from '@/lib/analytics/linkedin-metrics-sync';
import { logError } from '@/lib/logger';

type InsforgeClient = ReturnType<typeof createClient>;

const SUPPORTED = new Set(['twitter', 'instagram', 'linkedin']);
const MAX_JOBS = 60;

interface PublishJobRow {
  post_id: string;
  platform: string;
  provider_post_id: string | null;
}

export interface SyncUserMetricsResult {
  updated: number;
  skipped: number;
  failed: number;
  total: number;
}

/**
 * Pulls live metrics (and LinkedIn publish timestamps) for the user's published
 * posts and writes them onto `posts`. Repairs imported LinkedIn rows that were
 * stamped with the import date instead of the real publish time.
 */
export async function syncUserPostMetrics(
  client: InsforgeClient,
  userId: string,
): Promise<SyncUserMetricsResult> {
  const { data: jobs, error } = await client.database
    .from('publish_jobs')
    .select('post_id, platform, provider_post_id')
    .eq('user_id', userId)
    .eq('status', 'published')
    .not('provider_post_id', 'is', null)
    .limit(MAX_JOBS);

  if (error) {
    throw new Error(error.message);
  }

  const tokenCache = new Map<string, string | null>();
  async function getToken(platform: string): Promise<string | null> {
    if (tokenCache.has(platform)) return tokenCache.get(platform) ?? null;
    const { data: account } = await client.database
      .from('social_accounts')
      .select('access_token')
      .eq('user_id', userId)
      .eq('platform', platform)
      .maybeSingle();
    let token: string | null = null;
    if (account?.access_token) {
      try {
        token = decryptToken(account.access_token);
      } catch (e) {
        logError('[analytics-sync] token decrypt failed', { userId, platform }, e);
      }
    }
    tokenCache.set(platform, token);
    return token;
  }

  const linkedInTarget = await resolveLinkedInSyncTarget(client, userId);
  const linkedInJobs: Array<{ post_id: string; provider_post_id: string }> = [];

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const job of (jobs ?? []) as PublishJobRow[]) {
    if (!SUPPORTED.has(job.platform) || !job.provider_post_id) {
      skipped += 1;
      continue;
    }

    if (job.platform === 'linkedin') {
      linkedInJobs.push({ post_id: job.post_id, provider_post_id: job.provider_post_id });
    }

    try {
      let metricsPatch: Record<string, number> = {};
      let publishedAt: string | undefined;

      if (job.platform === 'linkedin') {
        if (!linkedInTarget) {
          skipped += 1;
          continue;
        }
        const details = await fetchLinkedInPostDetails(
          linkedInTarget.unipileAccountId,
          job.provider_post_id,
        );
        metricsPatch = metricsPatchFromNormalized(details.metrics);
        publishedAt = details.publishedAt;
      } else {
        const token = await getToken(job.platform);
        if (!token) {
          skipped += 1;
          continue;
        }
        const metrics =
          job.platform === 'twitter'
            ? await fetchTweetMetrics(token, job.provider_post_id)
            : await fetchInstagramMetrics(token, job.provider_post_id);
        metricsPatch = metricsPatchFromNormalized(metrics);
      }

      if (Object.keys(metricsPatch).length === 0 && !publishedAt) {
        skipped += 1;
        continue;
      }

      const postPatch: Record<string, string | number> = { ...metricsPatch };
      if (publishedAt) postPatch.posted_date = publishedAt.split('T')[0];

      const { error: updErr } = await client.database
        .from('posts')
        .update(postPatch)
        .eq('id', job.post_id)
        .eq('user_id', userId);

      if (updErr) {
        failed += 1;
        continue;
      }

      if (publishedAt) {
        await client.database
          .from('publish_jobs')
          .update({ updated_at: publishedAt })
          .eq('post_id', job.post_id)
          .eq('user_id', userId);
      }

      updated += 1;
    } catch (e) {
      failed += 1;
      logError('[analytics-sync] job failed', { postId: job.post_id, platform: job.platform }, e);
    }
  }

  if (linkedInTarget && linkedInJobs.length > 0) {
    updated += await backfillLinkedInMetricsFromPostList(
      client,
      userId,
      linkedInTarget,
      linkedInJobs,
      MAX_JOBS,
    );
  }

  return { updated, skipped, failed, total: jobs?.length ?? 0 };
}
