import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import { isEnabled } from '@/lib/feature-flags';
import { PILLAR_TO_VERTICAL } from '@/lib/hooks-intelligence/types';
import { updateFromPerformanceDB } from '@/lib/hooks-intelligence/rl-trainer';

/**
 * GET /api/cron/intelligence-sync
 * Schedule: 0 2 * * * (nightly 2am)
 *
 * Closes the RL loop: reads posts with real engagement data and updates
 * hook_performance scores via EMA. Posts are marked rl_processed_at so each
 * post is scored exactly once — future runs only touch genuinely new posts.
 *
 * No AI calls in L2 — pure EMA math on existing DB data.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  // --- Auth ---
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = getServiceClient();

  // --- Feature flag guard ---
  if (!await isEnabled(client, 'layer2_intelligence_sync')) {
    return NextResponse.json({ ok: true, skipped: true, reason: 'flag_disabled' });
  }

  try {
    // --- Fetch unprocessed posts with sufficient signal ---
    // Only posts where:
    //   - used_hook_ids is populated (hooks were injected during generation)
    //   - views >= 100 (below this is noise, not signal)
    //   - status = 'posted' (only published posts have real engagement)
    //   - rl_processed_at IS NULL (process once semantics — never re-score)
    const { data: posts, error: fetchError } = await client.database
      .from('posts')
      .select('id, pillar, saves, views, used_hook_ids')
      .is('rl_processed_at', null)
      .not('used_hook_ids', 'is', null)
      .gte('views', 100)
      .eq('status', 'posted')
      .order('created_at', { ascending: true })
      .limit(500);

    if (fetchError) {
      throw new Error(`Failed to fetch posts: ${fetchError.message}`);
    }

    let processed = 0;
    let hooksUpdated = 0;

    for (const post of posts ?? []) {
      const hookIds = post.used_hook_ids as string[] | null;
      if (!Array.isArray(hookIds) || hookIds.length === 0) continue;

      const vertical = PILLAR_TO_VERTICAL[post.pillar as string] ?? 'general';
      const views = Number(post.views) || 0;
      const saves = Number(post.saves) || 0;
      const saveRate = saves / Math.max(views, 1);
      const success = saveRate > 0.02 && saves >= 5;

      // Update EMA score for each hook that was used in this post's generation
      for (const hookId of hookIds) {
        await updateFromPerformanceDB(client, hookId, vertical, saveRate, success);
        hooksUpdated++;
      }

      // Mark post as processed — prevents re-scan on future cron runs
      await client.database
        .from('posts')
        .update({ rl_processed_at: new Date().toISOString() })
        .eq('id', post.id);

      processed++;
    }

    return NextResponse.json({ ok: true, processed, hooksUpdated });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'intelligence-sync failed' },
      { status: 500 },
    );
  }
}
