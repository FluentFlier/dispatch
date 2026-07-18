import { NextRequest, NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { logCronRun, cronStatusFromResults } from '@/lib/admin/cron-log';

/**
 * Fan-out cron: fires every 15 minutes.
 *
 * Always:        engagement-sync + event-enrich (parallel)
 * Hourly (:00):  calendar-sync
 * Every 6h (:00): metrics-sync (post analytics refresh)
 * Daily 8 AM UTC (:00): auto-generate
 * Daily 6 AM UTC (:00): trends-refresh (active users)
 * Weekly Mon 4 AM UTC (:00): hooks-refresh (niche mining)
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
  const dow = now.getUTCDay(); // 0=Sun .. 1=Mon

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
    call('gtmNurture', '/api/cron/gtm-nurture'),
  ];

  // Hourly: fires when cron hits the :00 minute mark
  if (minute === 0) {
    jobs.push(call('calendarSync', '/api/cron/calendar-sync'));
    // Directory lead digest - self-gates per-workspace local hour + idempotency,
    // so an hourly call only delivers each workspace once at its configured time.
    jobs.push(call('signalsDirectory', '/api/cron/signals-directory'));
  }

  // Every 6 hours (00/06/12/18 UTC): refresh post metrics from X + Instagram.
  // Spaced out to respect platform API rate limits - engagement grows slowly.
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

  // Daily 6 AM UTC: refresh "today's trend" for active users (per user+workspace).
  if (hour === 6 && minute === 0) {
    jobs.push(call('trendsRefresh', '/api/cron/trends-refresh'));
  }

  // Weekly Mon 4 AM UTC: mine fresh niche hooks (budget-capped inside the route).
  if (dow === 1 && hour === 4 && minute === 0) {
    jobs.push(call('hooksRefresh', '/api/cron/hooks-refresh'));
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

  // Do NOT block the HTTP response on the fan-out: sub-jobs (engagement-sync in
  // particular) are unbounded batch jobs that run for minutes, but cron-job.org
  // hard-kills the request at 30s → every run reported as a timeout (status=5).
  // Each sub-job is its own Vercel invocation, so drain them via waitUntil and
  // return immediately. The scheduler gets a fast 200; work continues server-side.
  const dispatched = jobs.length;
  waitUntil(
    Promise.all(jobs).then((outcomes) => {
      const result = Object.fromEntries(outcomes);
      const { status, errorMessage } = cronStatusFromResults(result);
      return logCronRun({
        jobName: 'medium',
        status,
        durationMs: Date.now() - started,
        summary: result,
        errorMessage,
      });
    }),
  );

  return NextResponse.json({ ok: true, dispatched });
}
