import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import { isEnabled } from '@/lib/feature-flags';
import { syncWorkspaceSignals } from '@/lib/signals/sync';
import { logError, logInfo } from '@/lib/logger';

/**
 * GET /api/cron/signals-sync
 * Poll configured sources, classify posts, create signal events.
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

    if (!(await isEnabled(client, 'signals_engine'))) {
      return NextResponse.json({ status: 'disabled', message: 'signals_engine flag off' });
    }

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
