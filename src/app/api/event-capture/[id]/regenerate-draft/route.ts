import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { sanitizeAnswer } from '@/lib/event-capture/draft-context';

interface RouteParams {
  params: { id: string };
}

/**
 * POST /api/event-capture/[id]/regenerate-draft
 * Re-runs draft generation for a capture using its stored answers. Fixes the
 * stuck state where a capture is 'drafted' but has zero posts (an earlier
 * generation failed, e.g. the pillar NOT-NULL bug, or /auto-draft was used with
 * no answers at all) and the /answers idempotency guard blocks re-submission.
 * Accepts an optional `answers` body — the zero-post detail view lets the user
 * answer questions right there, since it has no other route back into the
 * Q&A flow once a capture has left 'questions_ready'. Provided answers are
 * merged over whatever is already stored. Clears any prior posts for this
 * capture, flips status back to 'drafting', and fires the internal /process route.
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // No body is fine — falls back to whatever answers are already stored.
  }
  const rawAnswers = body && typeof body === 'object' ? (body as { answers?: unknown }).answers : null;
  const bodyAnswers =
    rawAnswers && typeof rawAnswers === 'object' ? (rawAnswers as Record<string, string>) : null;

  const client = getServerClient();

  const { data: capture } = await client.database
    .from('event_captures')
    .select('id, workspace_id, answers')
    .eq('id', params.id)
    .eq('workspace_id', workspaceId)
    .single();

  if (!capture) return NextResponse.json({ error: 'Capture not found' }, { status: 404 });

  const storedAnswers = (capture as { answers: Record<string, string> | null }).answers ?? {};
  const answers = { ...storedAnswers };
  if (bodyAnswers) {
    for (const [key, value] of Object.entries(bodyAnswers)) {
      if (typeof value === 'string') answers[key] = sanitizeAnswer(value);
    }
  }

  const nonEmpty = Object.values(answers).filter((v) => v.trim().length > 0);
  if (nonEmpty.length === 0) {
    return NextResponse.json(
      { error: 'Answer at least one question before generating a draft.' },
      { status: 422 },
    );
  }

  try {
    if (bodyAnswers) {
      await client.database
        .from('event_captures')
        .update({ answers, updated_at: new Date().toISOString() })
        .eq('id', params.id)
        .eq('workspace_id', workspaceId);
    }

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
