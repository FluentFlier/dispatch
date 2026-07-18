import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import { logCronRun } from '@/lib/admin/cron-log';
import { logError, logInfo } from '@/lib/logger';
import { detectTrendsForUser } from '@/lib/trends/detect';

/**
 * GET /api/cron/trends-refresh
 * Schedule: daily (fanned out from /api/cron/medium at 06:00 UTC).
 *
 * Refreshes "today's trend" for ACTIVE users only - anyone who touched a post in
 * the last ACTIVE_WINDOW_DAYS. Each user costs one Apify scrape + one LLM call,
 * so we cap the batch (TRENDS_REFRESH_MAX_USERS, default 50) rather than
 * fan out to the whole table. Per-user failures are isolated.
 */

const ACTIVE_WINDOW_DAYS = 14;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const started = Date.now();
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!process.env.APIFY_TOKEN) {
    await logCronRun({ jobName: 'trends-refresh', status: 'error', durationMs: Date.now() - started, errorMessage: 'APIFY_TOKEN missing' });
    return NextResponse.json({ ok: false, skipped: 'apify_token_missing' }, { status: 200 });
  }

  const maxUsers = Number(process.env.TRENDS_REFRESH_MAX_USERS ?? 50) || 50;
  const client = getServiceClient();
  const activeSince = new Date(Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  // Active = touched a post recently. Dedup user_ids in JS (SDK has no distinct).
  const { data: rows, error: rowsError } = await client.database
    .from('posts')
    .select('user_id, workspace_id, updated_at')
    .gte('updated_at', activeSince)
    .order('updated_at', { ascending: false });
  if (rowsError) {
    logError('[trends-refresh] failed to load active users', undefined, rowsError);
    await logCronRun({ jobName: 'trends-refresh', status: 'error', durationMs: Date.now() - started, errorMessage: rowsError.message });
    return NextResponse.json({ error: rowsError.message }, { status: 500 });
  }

  // Keep the first (most-recent) workspace_id seen per user as their active one.
  const wsByUser = new Map<string, string | null>();
  for (const r of (rows ?? []) as Array<{ user_id: string; workspace_id: string | null }>) {
    if (r.user_id && !wsByUser.has(r.user_id)) wsByUser.set(r.user_id, r.workspace_id ?? null);
  }
  const users = Array.from(wsByUser.entries()).slice(0, maxUsers);

  let refreshed = 0;
  let failed = 0;
  for (const [userId, workspaceId] of users) {
    try {
      const result = await detectTrendsForUser(client, userId, workspaceId);
      if (result.ok) refreshed++;
      else failed++;
    } catch (err) {
      failed++;
      logError('[trends-refresh] user refresh failed', { userId }, err);
    }
  }

  const status = failed === 0 ? 'ok' : refreshed === 0 ? 'error' : 'partial';
  const summary = { activeUsers: wsByUser.size, attempted: users.length, refreshed, failed, capped: wsByUser.size > maxUsers };
  logInfo('[trends-refresh] complete', summary);
  await logCronRun({ jobName: 'trends-refresh', status, durationMs: Date.now() - started, summary });
  return NextResponse.json({ ok: failed === 0, ...summary });
}
