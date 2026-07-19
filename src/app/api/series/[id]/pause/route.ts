import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { errorResponse } from '@/lib/api-errors';
import { z } from 'zod';
import { loadSeries } from '@/lib/series/db';

const Body = z.object({ position: z.number().int().min(1).optional() });

/**
 * Kill switch. With no position: pauses the whole series - deletes every queued
 * publish job so nothing fires, keeping scheduled_publish_at so resume can restore
 * it. With a position: cancels just that one part (deletes its job + clears its
 * slot) without pausing the rest. Deleting queued jobs (vs a new status) avoids a
 * publish_jobs schema change; the cron only ever picks queued/failed rows.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown = {};
  try { body = await request.json(); } catch { /* empty ok */ }
  const parsed = Body.safeParse(body ?? {});
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);
  const series = await loadSeries(client, params.id, user.id, workspaceId);
  if (!series) return NextResponse.json({ error: 'Series not found' }, { status: 404 });

  // Collect the target part ids (one part, or all parts of the series).
  let postQuery = client.database
    .from('posts')
    .select('id')
    .eq('series_id', series.id)
    .eq('user_id', user.id);
  if (parsed.data.position != null) postQuery = postQuery.eq('series_position', parsed.data.position);
  const { data: postRows } = await postQuery;
  const postIds = ((postRows ?? []) as { id: string }[]).map((p) => p.id);
  if (postIds.length === 0) return NextResponse.json({ error: 'No parts found' }, { status: 404 });

  // Remove queued/failed jobs so they can't fire; leave processing/published alone.
  const { error: jobErr } = await client.database
    .from('publish_jobs')
    .delete()
    .in('post_id', postIds)
    .eq('user_id', user.id)
    .in('status', ['queued', 'failed']);
  if (jobErr) return errorResponse('Could not cancel publish jobs.', 500, jobErr);

  await client.database
    .from('posts')
    .update({ publish_job_id: null })
    .in('id', postIds)
    .eq('user_id', user.id);

  if (parsed.data.position != null) {
    // Per-part cancel: clear that part's slot; series stays as-is.
    await client.database
      .from('posts')
      .update({ scheduled_publish_at: null })
      .in('id', postIds)
      .eq('user_id', user.id);
    return NextResponse.json({ cancelled: parsed.data.position });
  }

  await client.database
    .from('series')
    .update({ status: 'paused' })
    .eq('id', series.id)
    .eq('user_id', user.id);
  return NextResponse.json({ status: 'paused' });
}
