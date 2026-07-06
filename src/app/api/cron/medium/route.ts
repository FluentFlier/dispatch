import { NextRequest, NextResponse } from 'next/server';
import { logCronRun, cronStatusFromResults } from '@/lib/admin/cron-log';

/**
 * Fan-out cron: fires every 15 minutes.
 *
 * Always:        engagement-sync + event-enrich (parallel)
 * Hourly (:00):  calendar-sync
 * Every 6h (:00): metrics-sync (post analytics refresh)
 * Daily 8 AM UTC (:00): auto-generate
 * Daily 2 AM UTC (:00): intelligence-sync
 *
 * Time-gating absorbs former Vercel crons into one slot,
 * staying within the Hobby plan 2-cron limit without pg_cron.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const started = Date.now();
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!baseUrl) {
    return NextResponse.json({ error: 'NEXT_PUBLIC_APP_URL not set' }, { status: 500 });
  }

  const headers = { authorization: `Bearer ${cronSecret}` };
  const now = new Date();
  const minute = now.getUTCMinutes();
  const hour = now.getUTCHours();

  const call = async (
    name: string,
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<[string, unknown]> => {
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        method: init?.method ?? 'GET',
        headers: init?.body ? { ...headers, 'Content-Type': 'application/json' } : headers,
        body: init?.body ? JSON.stringify(init.body) : undefined,
      });
      return [name, await res.json()];
    } catch (err) {
      return [name, { error: String(err) }];
    }
  };

  const jobs: Promise<[string, unknown]>[] = [
    call('engagementSync', '/api/cron/engagement-sync'),
    call('eventEnrich', '/api/cron/event-enrich'),
  ];

  // Hourly: fires when cron hits the :00 minute mark
  if (minute === 0) {
    jobs.push(call('calendarSync', '/api/cron/calendar-sync'));
    // Directory lead digest — self-gates per-workspace local hour + idempotency,
    // so an hourly call only delivers each workspace once at its configured time.
    jobs.push(call('signalsDirectory', '/api/cron/signals-directory'));
  }

  // Every 6 hours (00/06/12/18 UTC): refresh post metrics from X + Instagram.
  // Spaced out to respect platform API rate limits — engagement grows slowly.
  if (minute === 0 && hour % 6 === 0) {
    jobs.push(call('metricsSync', '/api/cron/metrics-sync'));
  }

  // Daily 8 AM UTC
  if (hour === 8 && minute === 0) {
    jobs.push(call('autoGenerate', '/api/cron/auto-generate'));
  }

  // Daily 2 AM UTC
  if (hour === 2 && minute === 0) {
    jobs.push(call('intelligenceSync', '/api/cron/intelligence-sync'));
  }

  // Daily 3 AM UTC: social listening + Apify mining (POST-only route)
  if (hour === 3 && minute === 0) {
    jobs.push(
      call('intelligenceRun', '/api/intelligence/run', {
        method: 'POST',
        body: { mine: true, accounts: 20 },
      }),
    );
  }

  const outcomes = await Promise.all(jobs);
  const result = Object.fromEntries(outcomes);

  const { status, errorMessage } = cronStatusFromResults(result);
  void logCronRun({
    jobName: 'medium',
    status,
    durationMs: Date.now() - started,
    summary: result,
    errorMessage,
  });

  return NextResponse.json(result);
}
