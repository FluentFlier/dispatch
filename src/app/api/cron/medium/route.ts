import { NextRequest, NextResponse } from 'next/server';

/**
 * Fan-out cron: fires every 15 minutes, runs engagement-sync + event-enrich in parallel.
 * Exists solely to fit two medium-frequency jobs into one Vercel cron slot.
 * Each sub-job keeps its own auth check and is still independently callable.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
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

  const [engagementResult, eventEnrichResult] = await Promise.allSettled([
    fetch(`${baseUrl}/api/cron/engagement-sync`, { headers }).then((r) => r.json()),
    fetch(`${baseUrl}/api/cron/event-enrich`, { headers }).then((r) => r.json()),
  ]);

  return NextResponse.json({
    engagementSync:
      engagementResult.status === 'fulfilled'
        ? engagementResult.value
        : { error: String((engagementResult as PromiseRejectedResult).reason) },
    eventEnrich:
      eventEnrichResult.status === 'fulfilled'
        ? eventEnrichResult.value
        : { error: String((eventEnrichResult as PromiseRejectedResult).reason) },
  });
}
