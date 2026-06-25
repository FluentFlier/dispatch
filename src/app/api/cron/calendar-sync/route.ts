import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import { isEnabled } from '@/lib/feature-flags';
import { refreshGoogleToken, fetchCalendarEvents } from '@/lib/calendar/google';
import { shouldCaptureEvent, classifyEventType, isPublicEvent } from '@/lib/event-capture/filter';
import { encryptToken } from '@/lib/crypto';

// --- Types for DB rows ---

interface CalendarConnectionRow {
  id: string;
  workspace_id: string;
  user_id: string;
  provider: string;
  access_token: string;
  refresh_token: string | null;
  token_expires_at: string | null;
  calendar_id: string;
  calendar_name: string | null;
  last_synced_at: string | null;
}

/**
 * Stage 1 hourly cron: mirrors completed Google Calendar events into event_captures.
 *
 * For each workspace connection:
 *   1. Refresh access token if it expires within 5 minutes.
 *   2. Fetch events from Google Calendar (timeMin = last_synced_at or now-3h).
 *   3. Filter each event through duration/recency/allow-block lists.
 *   4. Upsert passing events into event_captures (DO NOTHING on conflict to preserve user edits).
 *   5. Enqueue an enrich_event job for each upserted capture.
 *   6. Write last_synced_at ONLY after successful fetch+upsert.
 *
 * Per-connection try/catch ensures one bad OAuth token never kills other users' sync.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  // --- Cron auth: Bearer CRON_SECRET required ---
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = getServiceClient();

  // --- Feature flag check ---
  if (!await isEnabled(client, 'layer1_calendar_sync')) {
    return NextResponse.json({ skipped: true, reason: 'flag_disabled' });
  }

  // --- Fetch all enabled calendar connections ---
  const { data: connections, error: connError } = await client.database
    .from('calendar_connections')
    .select('id, workspace_id, user_id, provider, access_token, refresh_token, token_expires_at, calendar_id, calendar_name, last_synced_at')
    .eq('sync_enabled', true)
    .eq('provider', 'google');

  if (connError) {
    console.error('[calendar-sync] Failed to fetch connections', connError);
    return NextResponse.json({ error: 'DB error' }, { status: 500 });
  }

  const rows = (connections ?? []) as CalendarConnectionRow[];
  const now = new Date();
  const results: Array<{ connectionId: string; status: string; eventsProcessed?: number }> = [];

  for (const conn of rows) {
    try {
      let accessToken = conn.access_token;

      // --- Token refresh: refresh if expires within 5 minutes ---
      if (conn.token_expires_at) {
        const expiresAt = new Date(conn.token_expires_at);
        const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

        if (expiresAt < fiveMinutesFromNow && conn.refresh_token) {
          try {
            const { accessToken: newToken, expiresAt: newExpiry } = await refreshGoogleToken(
              conn.refresh_token,
            );
            const encryptedNewToken = encryptToken(newToken);

            await client.database
              .from('calendar_connections')
              .update({
                access_token: encryptedNewToken,
                token_expires_at: newExpiry.toISOString(),
                sync_status: 'ok',
              })
              .eq('id', conn.id);

            accessToken = encryptedNewToken;
          } catch (refreshErr) {
            console.error('[calendar-sync] Token refresh failed', {
              connectionId: conn.id,
              err: refreshErr,
            });
            await client.database
              .from('calendar_connections')
              .update({ sync_status: 'error' })
              .eq('id', conn.id);
            results.push({ connectionId: conn.id, status: 'token_refresh_failed' });
            continue;
          }
        }
      }

      // --- Determine time window ---
      // Use last_synced_at as timeMin (no re-fetching), or now-3h for first run.
      const timeMin = conn.last_synced_at
        ? new Date(conn.last_synced_at)
        : new Date(now.getTime() - 3 * 60 * 60 * 1000);
      const timeMax = now;

      // --- Fetch events from Google Calendar ---
      const events = await fetchCalendarEvents(
        accessToken,
        conn.calendar_id,
        timeMin,
        timeMax,
      );

      let eventsUpserted = 0;

      for (const event of events) {
        if (!event.id || !event.summary) continue;

        const startTime = event.start.dateTime
          ? new Date(event.start.dateTime)
          : event.start.date
            ? new Date(event.start.date)
            : null;
        const endTime = event.end.dateTime
          ? new Date(event.end.dateTime)
          : event.end.date
            ? new Date(event.end.date)
            : null;

        if (!startTime || !endTime) continue;

        // --- Event filter ---
        const passes = shouldCaptureEvent(
          { title: event.summary, startTime, endTime },
          now,
        );
        if (!passes) continue;

        const eventType = classifyEventType(event.summary);
        const publicEvent = isPublicEvent(eventType);

        // Attendees: store names only by default (full consent stored in user_settings).
        const attendees = event.attendees
          ? event.attendees.map((a) => ({ name: a.displayName ?? a.email ?? 'Unknown' }))
          : null;

        // --- Upsert into event_captures: DO NOTHING on conflict to preserve user work ---
        const { data: upsertedRows, error: upsertError } = await client.database
          .from('event_captures')
          .upsert(
            {
              workspace_id: conn.workspace_id,
              user_id: conn.user_id,
              calendar_connection_id: conn.id,
              source: 'google',
              provider_event_id: event.id,
              title: event.summary,
              description: event.description ?? null,
              location: event.location ?? null,
              attendees,
              start_time: startTime.toISOString(),
              end_time: endTime.toISOString(),
              event_type: eventType,
              is_public_event: publicEvent,
              status: 'detected',
            },
            {
              onConflict: 'workspace_id,provider_event_id',
              ignoreDuplicates: true,
            },
          )
          .select('id');

        if (upsertError) {
          console.warn('[calendar-sync] Upsert failed for event', {
            eventId: event.id,
            err: upsertError,
          });
          continue;
        }

        // --- Enqueue enrich_event job for each newly inserted capture ---
        if (upsertedRows && upsertedRows.length > 0) {
          const captureId = (upsertedRows[0] as { id: string }).id;
          await client.database.from('jobs').insert({
            type: 'enrich_event',
            workspace_id: conn.workspace_id,
            payload: { event_capture_id: captureId },
            status: 'pending',
          });
          eventsUpserted++;
        }
      }

      // --- Write last_synced_at ONLY after successful fetch + upsert ---
      await client.database
        .from('calendar_connections')
        .update({
          last_synced_at: now.toISOString(),
          sync_status: 'ok',
        })
        .eq('id', conn.id);

      results.push({
        connectionId: conn.id,
        status: 'ok',
        eventsProcessed: eventsUpserted,
      });
    } catch (err) {
      // Per-connection catch: log and mark error, but continue to next connection.
      console.error('[calendar-sync] Connection error', { connectionId: conn.id, err });

      try {
        await client.database
          .from('calendar_connections')
          .update({ sync_status: 'error' })
          .eq('id', conn.id);
      } catch {
        // Best-effort — don't crash the cron over a status update failure.
      }

      results.push({ connectionId: conn.id, status: 'error' });
    }
  }

  return NextResponse.json({
    ok: true,
    connectionsProcessed: rows.length,
    results,
  });
}
