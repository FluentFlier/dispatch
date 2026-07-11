import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@insforge/sdk';
import { syncUserPostMetrics } from '@/lib/analytics/sync-user-metrics';
import { logError, logInfo } from '@/lib/logger';

/**
 * Cron endpoint: refresh real post metrics from the platforms.
 *
 * Delegates to syncUserPostMetrics (list backfill + capped per-post GETs) so
 * cron and the analytics page share one implementation.
 * Protected by CRON_SECRET.
 */

const MAX_USERS = 40;

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

  // Distinct users with published jobs that have a provider post id.
  const { data: jobs, error } = await admin.database
    .from('publish_jobs')
    .select('user_id')
    .eq('status', 'published')
    .not('provider_post_id', 'is', null)
    .limit(500);

  if (error) {
    logError('[metrics-sync] Failed to load publish_jobs', undefined, error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const userIds = Array.from(
    new Set(((jobs ?? []) as Array<{ user_id: string }>).map((j) => j.user_id).filter(Boolean)),
  ).slice(0, MAX_USERS);

  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let total = 0;

  for (const userId of userIds) {
    try {
      const result = await syncUserPostMetrics(admin, userId);
      updated += result.updated;
      skipped += result.skipped;
      failed += result.failed;
      total += result.total;
    } catch (e) {
      failed += 1;
      logError('[metrics-sync] user sync failed', { userId }, e);
    }
  }

  logInfo('[metrics-sync] Complete', { users: userIds.length, updated, skipped, failed, total });
  return NextResponse.json({ users: userIds.length, updated, skipped, failed, total });
}
