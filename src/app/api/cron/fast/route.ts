import { NextRequest, NextResponse } from 'next/server';
import { logCronRun, cronStatusFromResults } from '@/lib/admin/cron-log';

/**
 * Fan-out cron: fires every 5 minutes, runs publish + signals-sync +
 * engagement-tasks in parallel. Exists solely to fit high-frequency jobs into
 * one Vercel cron slot. Each sub-job keeps its own auth check and is still
 * independently callable.
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

  const [publishResult, signalsResult, engagementTasksResult] = await Promise.allSettled([
    fetch(`${baseUrl}/api/cron/publish`, { headers }).then((r) => r.json()),
    fetch(`${baseUrl}/api/cron/signals-sync`, { headers }).then((r) => r.json()),
    fetch(`${baseUrl}/api/cron/engagement-tasks`, { headers }).then((r) => r.json()),
  ]);

  const body = {
    publish:
      publishResult.status === 'fulfilled'
        ? publishResult.value
        : { error: String((publishResult as PromiseRejectedResult).reason) },
    signalsSync:
      signalsResult.status === 'fulfilled'
        ? signalsResult.value
        : { error: String((signalsResult as PromiseRejectedResult).reason) },
    engagementTasks:
      engagementTasksResult.status === 'fulfilled'
        ? engagementTasksResult.value
        : { error: String((engagementTasksResult as PromiseRejectedResult).reason) },
  };

  const { status, errorMessage } = cronStatusFromResults(body);
  void logCronRun({
    jobName: 'fast',
    status,
    durationMs: Date.now() - started,
    summary: body,
    errorMessage,
  });

  return NextResponse.json(body);
}
