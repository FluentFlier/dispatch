import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import { syncWorkspaceSignals } from '@/lib/signals/sync';
import { logError, logInfo } from '@/lib/logger';

/**
 * GET /api/cron/signals-sync
 * Poll tracked sources (accounts/topics), classify posts, and land detected
 * signals on matching LEADS via the intent bridge. The standalone signals
 * feature (and its signals_engine flag gate) is retired; this cron now only
 * powers lead monitoring, so it runs for any workspace with enabled sources.
 * Protected by CRON_SECRET.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const client = getServiceClient();

    const { data: sourceRows } = await client.database
      .from('signal_sources')
      .select('workspace_id')
      .eq('enabled', true);

    const workspaceIds = Array.from(
      new Set((sourceRows ?? []).map((r) => r.workspace_id as string).filter(Boolean)),
    ).slice(0, 50);

    const results = [];
    const batchSize = 5;
    for (let i = 0; i < workspaceIds.length; i += batchSize) {
      const batch = workspaceIds.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(async (workspaceId) => {
          try {
            const result = await syncWorkspaceSignals(client, workspaceId);
            logInfo('[signals-sync] workspace complete', {
              workspaceId,
              signals: result.signalsCreated,
            });
            return result;
          } catch (err) {
            logError('[signals-sync] workspace failed', {
              workspaceId,
              message: err instanceof Error ? err.message : String(err),
            });
            return {
              workspaceId,
              error: String(err),
            };
          }
        }),
      );
      results.push(...batchResults);
    }

    return NextResponse.json({ status: 'ok', results });
  } catch (err) {
    logError('[signals-sync] fatal', { message: String(err) });
    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}
