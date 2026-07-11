import type { createClient } from '@insforge/sdk';
import { decryptToken } from '@/lib/crypto';
import { hasPostMetrics, metricsPatchFromNormalized } from '@/lib/analytics/post-metrics';
import { fetchLinkedInPostDetails } from '@/lib/platforms/linkedin-metrics';
import { fetchTweetMetrics } from '@/lib/platforms/twitter-metrics';
import { fetchInstagramMetrics } from '@/lib/platforms/instagram-metrics';
import {
  backfillLinkedInMetricsFromPostList,
  resolveLinkedInSyncTarget,
} from '@/lib/analytics/linkedin-metrics-sync';
import { logError, logInfo } from '@/lib/logger';

type InsforgeClient = ReturnType<typeof createClient>;

const SUPPORTED = new Set(['twitter', 'instagram', 'linkedin']);
/** Cap per-user sync. Prefer newest jobs so the analytics page fills first. */
const MAX_JOBS = 80;
/**
 * Per-post LinkedIn GETs are slower than list backfill, but older posts fall
 * off the Unipile list window — keep enough budget to fill a typical analytics page.
 */
const MAX_LINKEDIN_DETAIL_FETCHES = 30;

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
  reason?: string;
}

/**
 * Pulls live metrics (and LinkedIn publish timestamps) for the user's published
 * posts and writes them onto `posts`.
 *
 * LinkedIn strategy (order matters for serverless timeouts):
 * 1. Bulk list backfill from GET /users/{id}/posts — counters are on the list payload
 * 2. Per-post GET only for remaining zero-metric jobs (capped)
 */
export async function syncUserPostMetrics(
  client: InsforgeClient,
  userId: string,
): Promise<SyncUserMetricsResult> {
  if (!process.env.UNIPILE_API_KEY?.trim() || !process.env.UNIPILE_DSN?.trim()) {
    const hasNonLinkedIn = true; // still try X/IG below; LinkedIn will no-op
    logInfo('[analytics-sync] Unipile env missing — LinkedIn sync will skip', { userId });
    void hasNonLinkedIn;
  }

  const { data: jobs, error } = await client.database
    .from('publish_jobs')
    .select('post_id, platform, provider_post_id')
    .eq('user_id', userId)
    .eq('status', 'published')
    .not('provider_post_id', 'is', null)
    .order('updated_at', { ascending: false })
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
  const otherJobs: PublishJobRow[] = [];

  for (const job of (jobs ?? []) as PublishJobRow[]) {
    if (!SUPPORTED.has(job.platform) || !job.provider_post_id) continue;
    if (job.platform === 'linkedin') {
      linkedInJobs.push({ post_id: job.post_id, provider_post_id: job.provider_post_id });
    } else {
      otherJobs.push(job);
    }
  }

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let reason: string | undefined;

  // 1) LinkedIn list backfill first — one request covers many posts.
  if (linkedInJobs.length > 0) {
    if (!linkedInTarget) {
      skipped += linkedInJobs.length;
      reason = 'LinkedIn account not resolvable via Unipile';
    } else if (!process.env.UNIPILE_API_KEY?.trim() || !process.env.UNIPILE_DSN?.trim()) {
      skipped += linkedInJobs.length;
      reason = 'UNIPILE_API_KEY / UNIPILE_DSN not configured';
    } else {
      updated += await backfillLinkedInMetricsFromPostList(
        client,
        userId,
        linkedInTarget,
        linkedInJobs,
        MAX_JOBS,
      );

      // 2) Per-post GET only for jobs still missing metrics (capped).
      let detailFetches = 0;
      for (const job of linkedInJobs) {
        if (detailFetches >= MAX_LINKEDIN_DETAIL_FETCHES) {
          skipped += 1;
          continue;
        }

        const { data: post } = await client.database
          .from('posts')
          .select('views, likes, saves, comments, shares')
          .eq('id', job.post_id)
          .eq('user_id', userId)
          .maybeSingle();

        if (post && hasPostMetrics(post as Parameters<typeof hasPostMetrics>[0])) {
          skipped += 1;
          continue;
        }

        detailFetches += 1;
        try {
          const details = await fetchLinkedInPostDetails(
            linkedInTarget.unipileAccountId,
            job.provider_post_id,
          );
          const metricsPatch = metricsPatchFromNormalized(details.metrics);
          if (Object.keys(metricsPatch).length === 0 && !details.publishedAt) {
            skipped += 1;
            continue;
          }

          const postPatch: Record<string, string | number> = { ...metricsPatch };
          if (details.publishedAt) postPatch.posted_date = details.publishedAt.split('T')[0];

          const { data: updatedRows, error: updErr } = await client.database
            .from('posts')
            .update(postPatch)
            .eq('id', job.post_id)
            .eq('user_id', userId)
            .select('id');

          if (updErr) {
            failed += 1;
            logError('[analytics-sync] LinkedIn detail update failed', { postId: job.post_id }, updErr);
            continue;
          }
          if (!updatedRows || updatedRows.length === 0) {
            failed += 1;
            logError('[analytics-sync] LinkedIn detail update matched 0 rows (RLS?)', {
              postId: job.post_id,
              userId,
            });
            continue;
          }
          updated += 1;
        } catch (e) {
          failed += 1;
          logError('[analytics-sync] LinkedIn detail fetch failed', { postId: job.post_id }, e);
        }
      }
    }
  }

  // 3) X / Instagram (token-based).
  for (const job of otherJobs) {
    if (!job.provider_post_id) {
      skipped += 1;
      continue;
    }
    try {
      const token = await getToken(job.platform);
      if (!token) {
        skipped += 1;
        continue;
      }
      const metrics =
        job.platform === 'twitter'
          ? await fetchTweetMetrics(token, job.provider_post_id)
          : await fetchInstagramMetrics(token, job.provider_post_id);
      const metricsPatch = metricsPatchFromNormalized(metrics);
      if (Object.keys(metricsPatch).length === 0) {
        skipped += 1;
        continue;
      }

      const { data: updatedRows, error: updErr } = await client.database
        .from('posts')
        .update(metricsPatch)
        .eq('id', job.post_id)
        .eq('user_id', userId)
        .select('id');

      if (updErr || !updatedRows || updatedRows.length === 0) {
        failed += 1;
        continue;
      }
      updated += 1;
    } catch (e) {
      failed += 1;
      logError('[analytics-sync] job failed', { postId: job.post_id, platform: job.platform }, e);
    }
  }

  if (updated === 0 && !reason && (jobs?.length ?? 0) === 0) {
    reason = 'No published posts with provider_post_id to sync';
  }

  return { updated, skipped, failed, total: jobs?.length ?? 0, reason };
}
