import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import { syncEngagementComments } from '@/lib/engagement/sync';
import { refreshLeadCategories } from '@/lib/engagement/categorize-engagers';
import { syncWarmContacts } from '@/lib/social-graph/warm-contacts';
import { runEngagerNurtureForWorkspace } from '@/lib/social-graph/engager-nurture';
import { socialGraphAvailable } from '@/lib/social-graph/unipile-reactions';
import { isEnabled } from '@/lib/feature-flags';
import { logError, logInfo } from '@/lib/logger';
import { usage } from '@/lib/hooks-intelligence/usage-tracker';

// Hobby plan caps function runtime at 60s; keep the loop under it and return
// cleanly instead of being killed mid-write.
export const maxDuration = 60;
const TIME_BUDGET_MS = 50_000; // stop starting new users past this; leaves headroom
const CALL_TIMEOUT_MS = 20_000; // abandon a single hung provider call

/** Reject a hung provider promise so one bad Unipile call can't stall the pass. */
function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${CALL_TIMEOUT_MS}ms`)), CALL_TIMEOUT_MS),
    ),
  ]);
}

/**
 * GET /api/cron/engagement-sync: pull comments for users with published posts.
 * Protected by CRON_SECRET Bearer token.
 *
 * Also triggers closed-loop intelligence:
 *  - Categorize engagers (ICP / leads etc for actionable analytics)
 *
 * Hook mining runs once daily via /api/intelligence/run (3 AM UTC fan-out).
 * RL hook scoring (Layer 2) is handled separately by /api/cron/intelligence-sync.
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
      engagers_nurtured?: number;
      errors: string[];
    }> = [];

    // Engager nurture is workspace-scoped; multiple synced users can map to the
    // same workspace, so run the sequence at most once per workspace per pass.
    const nurturedWorkspaces = new Set<string>();
    const nurtureEnabled =
      socialGraphAvailable() && (await isEnabled(client, 'loop_engager_nurture'));

    const deadline = Date.now() + TIME_BUDGET_MS;
    const candidates = userIds.slice(0, 50);
    let deferred = 0;

    for (const userId of candidates) {
      if (Date.now() > deadline) {
        deferred = candidates.length - results.length;
        logInfo('engagement-sync time budget reached, deferring remaining users', {
          processed: results.length,
          deferred,
        });
        break;
      }
      try {
        const result = await withTimeout(
          syncEngagementComments(client, userId, { fetchFromProvider: true }),
          'syncEngagementComments',
        );
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
            const warmResult = await withTimeout(
              syncWarmContacts(client, userId, workspaceId, { maxPosts: 5 }),
              'syncWarmContacts',
            );
            row.warm_contacts_upserted = warmResult.contactsUpserted;
            if (warmResult.errors.length) {
              row.errors.push(...warmResult.errors.map((e) => `warm: ${e}`));
            }

            // Run the full research -> comment -> connect -> DM sequence for
            // this workspace's engagers, once per workspace per pass. Failures
            // are captured but never fail the surrounding sync.
            if (nurtureEnabled && workspaceId && !nurturedWorkspaces.has(workspaceId)) {
              nurturedWorkspaces.add(workspaceId);
              const nurture = await withTimeout(
                runEngagerNurtureForWorkspace(client, workspaceId),
                'runEngagerNurtureForWorkspace',
              );
              row.engagers_nurtured =
                nurture.planned + nurture.connectsSent + nurture.dmsSent;
              if (nurture.errors.length) {
                row.errors.push(...nurture.errors.map((e) => `nurture: ${e}`));
              }
              logInfo('engagement-sync engager nurture', { workspaceId, ...nurture });
            }
          } catch (warmErr) {
            logError('engagement-sync warm contacts failed', {
              userId,
              message: warmErr instanceof Error ? warmErr.message : String(warmErr),
            });
          }
        }

        results.push(row);

        // === CLOSED LOOP: rebuild the audience/lead snapshot from synced
        // comments + reactions. Gated by feature flag; failures here must not
        // fail the sync - categorization is derived data. RL hook scoring is
        // handled separately by the nightly intelligence-sync cron.
        await usage.track(userId, 'analytics', { source: 'cron-engagement-sync' });

        if (await isEnabled(client, 'loop_engagement_categorize')) {
          try {
            const categorized = await refreshLeadCategories(client, userId);
            logInfo('engagement-sync lead categorization', {
              userId,
              engagers: categorized.engagers,
              ...categorized.categorized,
            });
          } catch (catErr) {
            logError('lead categorization failed', {
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

    logInfo('engagement-sync cron complete', { users: results.length, deferred });
    return NextResponse.json({ ok: true, users: results.length, deferred, results });
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
