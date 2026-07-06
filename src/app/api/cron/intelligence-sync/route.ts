import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import { isEnabled } from '@/lib/feature-flags';
import { updateFromPerformanceDB, extractWinningPatterns } from '@/lib/hooks-intelligence/rl-trainer';
import { countLeadsForPost, pillarToVertical } from '@/lib/engagement/categorize-leads';
import { trackEvent } from '@/lib/analytics';

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
      .select('id, pillar, saves, views, likes, comments, used_hook_ids')
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

      const vertical = pillarToVertical(post.pillar as string);
      const views = Number(post.views) || 0;
      const saves = Number(post.saves) || 0;
      const likes = Number((post as { likes?: number }).likes) || 0;
      const comments = Number((post as { comments?: number }).comments) || 0;
      const engagementRate = (saves + likes + comments) / Math.max(views, 1);
      const saveRate = saves / Math.max(views, 1);
      const success = engagementRate > 0.03 || (saveRate > 0.02 && saves >= 5);
      const leadsGenerated = await countLeadsForPost(client, post.id as string);

      // Update EMA score for each hook that was used in this post's generation
      for (const hookId of hookIds) {
        await updateFromPerformanceDB(client, hookId, vertical, saveRate, success, leadsGenerated);
        hooksUpdated++;
      }

      // Mark post as processed — prevents re-scan on future cron runs
      await client.database
        .from('posts')
        .update({ rl_processed_at: new Date().toISOString() })
        .eq('id', post.id);

      processed++;
    }

    if (hooksUpdated > 0) {
      void trackEvent('rl_hooks_updated', { processed, hooksUpdated });
    }

    const winningPatterns = extractWinningPatterns(50);

    return NextResponse.json({ ok: true, processed, hooksUpdated, winningPatterns: winningPatterns.length });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'intelligence-sync failed' },
      { status: 500 },
    );
  }
}
