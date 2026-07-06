import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import { syncEngagementComments } from '@/lib/engagement/sync';
import { categorizeRecentEngagers } from '@/lib/engagement/categorize-leads';
import { syncWarmContacts } from '@/lib/social-graph/warm-contacts';
import { socialGraphAvailable } from '@/lib/social-graph/unipile-reactions';
import { isEnabled } from '@/lib/feature-flags';
import { logError, logInfo } from '@/lib/logger';
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
    const results: Array<{
      user_id: string;
      synced: number;
      warm_contacts_upserted?: number;
      errors: string[];
    }> = [];

    for (const userId of userIds.slice(0, 50)) {
      try {
        const result = await syncEngagementComments(client, userId, { fetchFromProvider: true });
        const row: (typeof results)[number] = {
          user_id: userId,
          synced: result.synced,
          errors: result.errors,
        };

        // === Warm contacts: post reactions → ICP triage (UseSocial-style) ===
        if (socialGraphAvailable() && (await isEnabled(client, 'loop_warm_contacts_sync'))) {
          try {
            const { data: member } = await client.database
              .from('workspace_members')
              .select('workspace_id')
              .eq('user_id', userId)
              .limit(1)
              .maybeSingle();
            const workspaceId = (member?.workspace_id as string | undefined) ?? null;
            const warmResult = await syncWarmContacts(client, userId, workspaceId, {
              maxPosts: 5,
            });
            row.warm_contacts_upserted = warmResult.contactsUpserted;
            if (warmResult.errors.length) {
              row.errors.push(...warmResult.errors.map((e) => `warm: ${e}`));
            }
          } catch (warmErr) {
            logError('engagement-sync warm contacts failed', {
              userId,
              message: warmErr instanceof Error ? warmErr.message : String(warmErr),
            });
          }
        }

        results.push(row);

        // === CLOSED LOOP: categorize engagers into lead_categories ===
        await usage.track(userId, 'analytics', { source: 'cron-engagement-sync' });

        if (await isEnabled(client, 'loop_engagement_categorize')) {
          try {
            const leadResult = await categorizeRecentEngagers(client, userId);
            if (leadResult.categorized > 0) {
              logInfo('[engagement-sync] lead categorization', { userId, ...leadResult });
            }
          } catch (catErr) {
            logError('engagement-sync categorize failed', {
              userId,
              message: catErr instanceof Error ? catErr.message : String(catErr),
            });
          }
        }
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
