import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';

interface RouteParams {
  params: { id: string };
}

/**
 * POST /api/event-capture/[id]/regenerate-draft
 * Re-runs draft generation for a capture using its stored answers. Fixes the
 * stuck state where a capture is 'drafted' but has zero posts (an earlier
 * generation failed, e.g. the pillar NOT-NULL bug) and the /answers idempotency
 * guard blocks re-submission. Clears any prior posts for this capture, flips
 * status back to 'drafting', and fires the internal /process route.
 */
export async function POST(
  _request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  const client = getServerClient();

  const { data: capture } = await client.database
    .from('event_captures')
    .select('id, workspace_id, answers')
    .eq('id', params.id)
    .eq('workspace_id', workspaceId)
    .single();

  if (!capture) return NextResponse.json({ error: 'Capture not found' }, { status: 404 });

  const answers = (capture as { answers: Record<string, string> | null }).answers ?? {};
  if (Object.keys(answers).length === 0) {
    return NextResponse.json(
      { error: 'Answer at least one question before generating a draft.' },
      { status: 422 },
    );
  }

  try {
    // Clear any prior (failed/partial) posts so a retry doesn't duplicate.
    await client.database
      .from('posts')
      .delete()
      .eq('event_capture_id', params.id)
      .eq('workspace_id', workspaceId);

    await client.database
      .from('event_captures')
      .update({ status: 'drafting', updated_at: new Date().toISOString() })
      .eq('id', params.id)
      .eq('workspace_id', workspaceId);

    // Fire-and-forget to the internal /process route (same pattern as /answers).
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
    const cronSecret = process.env.CRON_SECRET ?? '';
    void fetch(`${appUrl}/api/event-capture/${params.id}/process`, {
      method: 'POST',
      headers: { 'x-internal-secret': cronSecret, 'Content-Type': 'application/json' },
    }).catch((err) => console.error('[event-capture/regenerate-draft] fire-and-forget error', err));

    return NextResponse.json({ captureId: params.id }, { status: 202 });
  } catch (err) {
    console.error('[event-capture/regenerate-draft] error', err);
    return NextResponse.json({ error: 'Failed to regenerate draft' }, { status: 500 });
  }
}
