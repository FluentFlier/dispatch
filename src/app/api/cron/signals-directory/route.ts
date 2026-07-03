import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import { runWorkspaceDigest } from '@/lib/signals/leads/digest';
import { logError, logInfo } from '@/lib/logger';

/**
 * GET /api/cron/signals-directory
 * Hourly digest cron. For every workspace with directory settings, runWorkspaceDigest
 * gates on the workspace's local time + a delivered-today idempotency guard, so
 * only workspaces whose local hour has reached their configured digest hour run,
 * once per day (with free catch-up for a missed hour). Protected by CRON_SECRET.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const client = getServiceClient();

    const { data: settingsRows } = await client.database
      .from('signal_directory_settings')
      .select('workspace_id');
    const workspaceIds = Array.from(
      new Set((settingsRows ?? []).map((r) => r.workspace_id as string).filter(Boolean)),
    ).slice(0, 200);

    const now = new Date();
    const results: Array<Record<string, unknown>> = [];
    const batchSize = 5;
    for (let i = 0; i < workspaceIds.length; i += batchSize) {
      const batch = workspaceIds.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (workspaceId) => {
          try {
            const r = await runWorkspaceDigest(client, workspaceId, now);
            if (r.ran) logInfo('[signals-directory] digest sent', { workspaceId, count: r.count, channels: r.channels });
            return { workspaceId, ...r };
          } catch (err) {
            logError('[signals-directory] workspace failed', {
              workspaceId,
              message: err instanceof Error ? err.message : String(err),
            });
            return { workspaceId, ran: false, error: String(err) };
          }
        }),
      );
      results.push(...batchResults);
    }

    return NextResponse.json({ status: 'ok', ran: results.filter((r) => r.ran).length, results });
  } catch (err) {
    logError('[signals-directory] fatal', { message: String(err) });
    return NextResponse.json({ error: 'Digest cron failed' }, { status: 500 });
  }
}
