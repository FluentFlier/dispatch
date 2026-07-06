import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import { runGtmNurtureForWorkspace } from '@/lib/gtm/nurture/auto-send';
import { logError, logInfo } from '@/lib/logger';

/**
 * GET /api/cron/gtm-nurture
 * Prepares new ICP leads and auto-sends due LinkedIn connects (safety-capped).
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
    ).slice(0, 100);

    const results = [];
    for (const workspaceId of workspaceIds) {
      try {
        const r = await runGtmNurtureForWorkspace(client, workspaceId);
        if (r.prepared > 0 || r.connectsSent > 0) {
          logInfo('[gtm-nurture] workspace run', { workspaceId, ...r });
        }
        results.push({ workspaceId, ...r });
      } catch (err) {
        logError('[gtm-nurture] workspace failed', {
          workspaceId,
          message: err instanceof Error ? err.message : String(err),
        });
        results.push({ workspaceId, error: String(err) });
      }
    }

    return NextResponse.json({
      ok: true,
      workspaces: results.length,
      prepared: results.reduce((s, r) => s + ((r as { prepared?: number }).prepared ?? 0), 0),
      connectsSent: results.reduce((s, r) => s + ((r as { connectsSent?: number }).connectsSent ?? 0), 0),
      results,
    });
  } catch (err) {
    logError('[gtm-nurture] fatal', { message: String(err) });
    return NextResponse.json({ error: 'GTM nurture cron failed' }, { status: 500 });
  }
}
