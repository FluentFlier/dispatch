import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import { runEngagementTaskQueue } from '@/lib/engagement/tasks';
import { logError, logInfo } from '@/lib/logger';

/**
 * GET /api/cron/engagement-tasks: post approved outbound comments/reactions.
 * Protected by CRON_SECRET Bearer token; invoked by the fast fan-out cron.
 *
 * The worker claims tasks with lease-based locking (see runEngagementTaskQueue),
 * so overlapping invocations never double-post. Small batch per run keeps
 * outbound activity drip-fed rather than bursty - LinkedIn watches for bursts.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const client = getServiceClient();
    const result = await runEngagementTaskQueue(client, 5);
    logInfo('engagement-tasks cron complete', { ...result });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    logError('engagement-tasks cron error', {
      message: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Cron failed' },
      { status: 500 },
    );
  }
}
