import { NextRequest, NextResponse } from 'next/server';

/**
 * Fan-out cron: fires every 5 minutes, runs publish + signals-sync in parallel.
 * Exists solely to fit two high-frequency jobs into one Vercel cron slot.
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

  const [publishResult, signalsResult] = await Promise.allSettled([
    fetch(`${baseUrl}/api/cron/publish`, { headers }).then((r) => r.json()),
    fetch(`${baseUrl}/api/cron/signals-sync`, { headers }).then((r) => r.json()),
  ]);

  return NextResponse.json({
    publish:
      publishResult.status === 'fulfilled'
        ? publishResult.value
        : { error: String((publishResult as PromiseRejectedResult).reason) },
    signalsSync:
      signalsResult.status === 'fulfilled'
        ? signalsResult.value
        : { error: String((signalsResult as PromiseRejectedResult).reason) },
  });
}
