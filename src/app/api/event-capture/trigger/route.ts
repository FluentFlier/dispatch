import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient, getServiceClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';

/**
 * POST /api/event-capture/trigger
 * Manually re-enqueues all 'detected' captures for the active workspace.
 * Used from the calendar settings page when a user wants to force enrich
 * without waiting for the next 15-minute cron window.
 * Returns the count of jobs enqueued.
 *
 * jobs is a service-managed table with RLS enabled and zero user-facing
 * policies (by design - only the cron and this route ever write to it), so
 * the insert must go through the service client. The event_captures read
 * stays on the user client so RLS still enforces the workspace/ownership
 * check on what "detected" rows this caller is even allowed to see.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) {
    return NextResponse.json({ error: 'No active workspace' }, { status: 400 });
  }

  const client = getServerClient();

  // Fetch all detected captures for this workspace.
  const { data: captures, error: fetchError } = await client.database
    .from('event_captures')
    .select('id, workspace_id')
    .eq('workspace_id', workspaceId)
    .eq('status', 'detected');

  if (fetchError) {
    console.error('[event-capture/trigger] Fetch error', fetchError);
    return NextResponse.json({ error: 'Failed to fetch captures' }, { status: 500 });
  }

  if (!captures || captures.length === 0) {
    return NextResponse.json({ ok: true, enqueued: 0 });
  }

  // Enqueue an enrich_event job for each detected capture.
  const jobs = captures.map((c: { id: string; workspace_id: string }) => ({
    type: 'enrich_event',
    workspace_id: c.workspace_id,
    payload: { event_capture_id: c.id },
    status: 'pending',
  }));

  const serviceClient = getServiceClient();
  const { error: insertError } = await serviceClient.database.from('jobs').insert(jobs);

  if (insertError) {
    console.error('[event-capture/trigger] Job insert error', insertError);
    return NextResponse.json({ error: 'Failed to enqueue jobs' }, { status: 500 });
  }

  return NextResponse.json({ ok: true, enqueued: jobs.length });
}
