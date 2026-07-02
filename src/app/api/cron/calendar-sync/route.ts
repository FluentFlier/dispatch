import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import { isEnabled } from '@/lib/feature-flags';
import { pullCalendarEvents } from '@/lib/event-capture/sources/calendar-composio';
import { scanLinkedInForEvents } from '@/lib/event-capture/sources/linkedin-scan';
import { ingestEvents, cancelMissingEvents } from '@/lib/event-capture/ingest';
import type { SignalIntegrationRow } from '@/lib/signals/integrations/store';

/**
 * Stage 1 hourly cron. For each workspace with a Composio Google Calendar
 * integration: pull recent events and ingest them. If a workspace produced NO
 * new calendar captures this run, fall back to scanning the connecting user's
 * own LinkedIn posts for future-event mentions (the detection cascade).
 * Per-workspace try/catch - one bad integration never kills the loop.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = getServiceClient();
  if (!(await isEnabled(client, 'layer1_calendar_sync'))) {
    return NextResponse.json({ skipped: true, reason: 'flag_disabled' });
  }

  const now = new Date();
  const results: Array<{ workspaceId: string; calendar: number; linkedin: number; status: string }> = [];

  const { data: calRows, error } = await client.database
    .from('signal_integrations')
    .select('*')
    .eq('toolkit', 'googlecalendar')
    .eq('enabled', true);

  if (error) {
    console.error('[calendar-sync] failed to list integrations', error);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }

  for (const integration of (calRows ?? []) as SignalIntegrationRow[]) {
    const workspaceId = integration.workspace_id;
    const userId = integration.connected_by_user_id;
    try {
      if (!userId) {
        results.push({ workspaceId, calendar: 0, linkedin: 0, status: 'no_user' });
        continue;
      }

      const calEvents = await pullCalendarEvents(integration, now);
      const calRes = await ingestEvents(client, { workspaceId, userId }, calEvents, now, 'incremental');

      // Deletion pass over the cron lookback window (same window pullCalendarEvents used).
      const lookbackMs = 3 * 60 * 60 * 1000;
      const cancelled = await cancelMissingEvents(
        client,
        { workspaceId },
        { timeMin: new Date(now.getTime() - lookbackMs), timeMax: now },
        new Set(calEvents.map((e) => e.providerEventId)),
      );

      let liCreated = 0;
      if (calRes.created === 0) {
        // Cascade fallback: nothing fresh in the calendar, so check LinkedIn posts.
        const liEvents = await scanLinkedInForEvents(client, { workspaceId, userId }, now);
        const liRes = await ingestEvents(client, { workspaceId, userId }, liEvents, now, 'incremental');
        liCreated = liRes.created;
      }

      results.push({ workspaceId, calendar: calRes.created, linkedin: liCreated, status: cancelled > 0 ? 'ok+cancelled' : 'ok' });
    } catch (err) {
      console.error('[calendar-sync] workspace error', { workspaceId, err });
      results.push({ workspaceId, calendar: 0, linkedin: 0, status: 'error' });
    }
  }

  return NextResponse.json({ ok: true, workspacesProcessed: results.length, results });
}
