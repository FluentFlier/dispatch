import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@insforge/sdk';
import { decryptToken } from '@/lib/crypto';
import { fetchTweetMetrics, type NormalizedMetrics } from '@/lib/platforms/twitter-metrics';
import { fetchInstagramMetrics } from '@/lib/platforms/instagram-metrics';
import { fetchLinkedInMetrics } from '@/lib/platforms/linkedin-metrics';
import { logError, logInfo } from '@/lib/logger';

/**
 * Cron endpoint: refresh real post metrics from the platforms.
 *
 * WHY: analytics used to rely on hand-entered numbers. This pulls live metrics
 * for recently published posts (X + Instagram) and writes them onto the
 * existing posts.{views,likes,saves,comments,shares} columns, so Performance
 * and the best-time engine run on real data.
 *
 * X and Instagram use their own APIs (decrypted OAuth token). LinkedIn goes
 * through the user's connected Unipile account instead — LinkedIn's official
 * API hides post metrics, but Unipile exposes impressions/reactions/reposts.
 * Threads is deferred. Protected by CRON_SECRET.
 */

/** Only pull metrics for posts published within this window (days). */
const LOOKBACK_DAYS = 14;
const SUPPORTED = new Set(['twitter', 'instagram', 'linkedin']);

interface PublishJobRow {
  post_id: string;
  user_id: string;
  platform: string;
  provider_post_id: string | null;
  updated_at: string;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_INSFORGE_URL;
  const serviceKey = process.env.INSFORGE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json({ error: 'Missing service config' }, { status: 500 });
  }

  const admin = createClient({ baseUrl: url, anonKey: serviceKey, isServerMode: true });
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Recently published jobs that carry a platform post id we can look up.
  const { data: jobs, error } = await admin.database
    .from('publish_jobs')
    .select('post_id, user_id, platform, provider_post_id, updated_at')
    .eq('status', 'published')
    .gte('updated_at', since)
    .not('provider_post_id', 'is', null);

  if (error) {
    logError('[metrics-sync] Failed to load publish_jobs', undefined, error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Cache one decrypted token per user+platform to avoid re-querying/decrypting.
  const tokenCache = new Map<string, string | null>();
  async function getToken(userId: string, platform: string): Promise<string | null> {
    const cacheKey = `${userId}:${platform}`;
    if (tokenCache.has(cacheKey)) return tokenCache.get(cacheKey) ?? null;
    const { data: account } = await admin.database
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
        logError('[metrics-sync] Token decrypt failed', { userId, platform }, e);
      }
    }
    tokenCache.set(cacheKey, token);
    return token;
  }

  // LinkedIn metrics go through Unipile, keyed by the connected account id —
  // there is no OAuth token to decrypt on that path.
  const unipileCache = new Map<string, string | null>();
  async function getUnipileAccount(userId: string): Promise<string | null> {
    if (unipileCache.has(userId)) return unipileCache.get(userId) ?? null;
    const { data: account } = await admin.database
      .from('social_accounts')
      .select('unipile_account_id')
      .eq('user_id', userId)
      .eq('platform', 'linkedin')
      .not('unipile_account_id', 'is', null)
      .limit(1)
      .maybeSingle();
    const id = (account as { unipile_account_id: string } | null)?.unipile_account_id ?? null;
    unipileCache.set(userId, id);
    return id;
  }

  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const job of (jobs ?? []) as PublishJobRow[]) {
    if (!SUPPORTED.has(job.platform) || !job.provider_post_id) {
      skipped += 1;
      continue;
    }
    try {
      let metrics: NormalizedMetrics = {};
      if (job.platform === 'linkedin') {
        const unipileAccountId = await getUnipileAccount(job.user_id);
        if (!unipileAccountId) {
          skipped += 1;
          continue;
        }
        metrics = await fetchLinkedInMetrics(unipileAccountId, job.provider_post_id);
      } else {
        const token = await getToken(job.user_id, job.platform);
        if (!token) {
          skipped += 1;
          continue;
        }
        if (job.platform === 'twitter') {
          metrics = await fetchTweetMetrics(token, job.provider_post_id);
        } else if (job.platform === 'instagram') {
          metrics = await fetchInstagramMetrics(token, job.provider_post_id);
        }
      }

      // Only write metrics we actually received (never zero-out unknowns).
      const patch: Record<string, number> = {};
      if (typeof metrics.views === 'number') patch.views = metrics.views;
      if (typeof metrics.likes === 'number') patch.likes = metrics.likes;
      if (typeof metrics.saves === 'number') patch.saves = metrics.saves;
      if (typeof metrics.comments === 'number') patch.comments = metrics.comments;
      if (typeof metrics.shares === 'number') patch.shares = metrics.shares;

      if (Object.keys(patch).length === 0) {
        skipped += 1;
        continue;
      }

      const { error: updErr } = await admin.database
        .from('posts')
        .update(patch)
        .eq('id', job.post_id);
      if (updErr) {
        failed += 1;
        logError('[metrics-sync] Post update failed', { postId: job.post_id }, updErr);
        continue;
      }
      updated += 1;
    } catch (e) {
      failed += 1;
      logError('[metrics-sync] Job failed', { postId: job.post_id, platform: job.platform }, e);
    }
  }

  logInfo('[metrics-sync] Complete', { updated, skipped, failed, total: jobs?.length ?? 0 });
  return NextResponse.json({ updated, skipped, failed, total: jobs?.length ?? 0 });
}
