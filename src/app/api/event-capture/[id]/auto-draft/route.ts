import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';

interface RouteParams {
  params: { id: string };
}

/**
 * POST /api/event-capture/[id]/auto-draft
 * Quick-draft escape hatch: generates drafts without Q&A answers.
 * Sets answers={} and proceeds with the same background generation pipeline.
 * Returns 202 + { mode: 'auto' } so the UI can show a lower voice_match expectation.
 *
 * Validates workspace ownership and idempotency (same rules as /answers).
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) {
    return NextResponse.json({ error: 'No active workspace' }, { status: 400 });
  }

  const client = getServerClient();

  const { data: capture, error: fetchError } = await client.database
    .from('event_captures')
    .select('id, workspace_id')
    .eq('id', params.id)
    .eq('workspace_id', workspaceId)
    .single();

  if (fetchError || !capture) {
    return NextResponse.json({ error: 'Capture not found' }, { status: 404 });
  }

  // Atomic idempotency guard - see answers/route.ts for the full rationale:
  // the status check lives in the UPDATE's WHERE clause, not a prior SELECT,
  // so two concurrent auto-draft calls can't both pass and both proceed.
  const { data: updatedRows, error: updateError } = await client.database
    .from('event_captures')
    .update({
      answers: {},
      status: 'drafting',
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id)
    .eq('workspace_id', workspaceId)
    .neq('status', 'drafting')
    .neq('status', 'drafted')
    .select('id');

  if (updateError) {
    console.error('[event-capture/auto-draft] Update error', updateError);
    return NextResponse.json({ error: 'Failed to start auto-draft' }, { status: 500 });
  }

  if (!updatedRows || updatedRows.length === 0) {
    return NextResponse.json(
      { error: 'Draft generation already started', captureId: params.id, mode: 'auto' },
      { status: 409 },
    );
  }

  // Same fire-and-forget to /process as the Q&A path.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const cronSecret = process.env.CRON_SECRET ?? '';

  void fetch(`${appUrl}/api/event-capture/${params.id}/process`, {
    method: 'POST',
    headers: {
      'x-internal-secret': cronSecret,
      'Content-Type': 'application/json',
    },
  }).catch((err) => {
    console.error('[event-capture/auto-draft] fire-and-forget error', err);
  });

  return NextResponse.json({ captureId: params.id, mode: 'auto' }, { status: 202 });
}
