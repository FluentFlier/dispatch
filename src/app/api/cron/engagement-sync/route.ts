import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import { syncEngagementComments } from '@/lib/engagement/sync';
import { logError, logInfo } from '@/lib/logger';
import { bucketEngagers } from '@/lib/hooks-intelligence/categorize';
import { prodMining } from '@/lib/hooks-intelligence/prod-mining';
import { usage } from '@/lib/hooks-intelligence/usage-tracker';

/**
 * GET /api/cron/engagement-sync: pull comments for users with published posts.
 * Protected by CRON_SECRET Bearer token.
 *
 * Also triggers closed-loop intelligence:
 *  - Categorize engagers (ICP / leads etc for actionable analytics)
 *  - Scheduled prod mining (Apify in prod, gstack fallback in dev)
 *
 * Note: RL hook scoring (Layer 2) is handled separately by /api/cron/intelligence-sync.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const client = getServiceClient();
    const { data: jobs } = await client.database
      .from('publish_jobs')
      .select('user_id')
      .eq('status', 'published')
      .not('provider_post_id', 'is', null)
      .limit(200);

    const userIds = Array.from(new Set((jobs ?? []).map((j: { user_id: string }) => j.user_id)));
    const results: Array<{ user_id: string; synced: number; errors: string[] }> = [];

    for (const userId of userIds.slice(0, 50)) {
      try {
        const result = await syncEngagementComments(client, userId, { fetchFromProvider: true });
        results.push({
          user_id: userId,
          synced: result.synced,
          errors: result.errors,
        });

        // === CLOSED LOOP INTELLIGENCE (after every sync) ===
        // 1. Usage tracking for monetization
        await usage.track(userId, 'analytics', { source: 'cron-engagement-sync' });

        // 2. TODO: Pull recent engagers for this user and categorize (ICP/leads)
        // For now the categorize is ready; full wiring needs engager fetch in sync result
        // Placeholder: if sync returned engagers we would do:
        // const buckets = bucketEngagers(engagersFromSync, orgKeywords);
        // then pass leads count into PerformanceSignal for RL
        //
        // Note: RL training (hook scoring) is handled by the nightly intelligence-sync
        // cron (/api/cron/intelligence-sync). This cron stays fast — engagement only.
      } catch (err) {
        logError('engagement-sync user failed', {
          userId,
          message: err instanceof Error ? err.message : String(err),
        });
        results.push({
          user_id: userId,
          synced: 0,
          errors: [err instanceof Error ? err.message : 'sync failed'],
        });
      }
    }

    // === HYBRID PROD MINING (GStack dev / Apify prod) ===
    // Runs once per cron invocation when flag set. Cost controlled.
    if (process.env.USE_PROD_MINING === 'true' || process.env.NODE_ENV === 'production') {
      try {
        await prodMining.scheduledMineForOrg('system'); // multi-tenant: loop over orgs with watchlists in future
        logInfo('[Cron] Prod mining triggered');
      } catch (mineErr) {
        logError('prod-mining in cron failed', { message: String(mineErr) });
      }
    }

    logInfo('engagement-sync cron complete', { users: results.length });
    return NextResponse.json({ ok: true, users: results.length, results });
  } catch (err) {
    logError('engagement-sync cron error', {
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Cron failed' },
      { status: 500 },
    );
  }
}
