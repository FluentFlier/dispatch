import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import { syncEngagementComments } from '@/lib/engagement/sync';
import { logError, logInfo } from '@/lib/logger';

/**
 * GET /api/cron/engagement-sync — pull comments for users with published posts.
 * Protected by CRON_SECRET Bearer token.
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
