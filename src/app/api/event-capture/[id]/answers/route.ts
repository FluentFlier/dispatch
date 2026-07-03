import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';

interface RouteParams {
  params: { id: string };
}

// Answers is a record of question index (string "0".."4") to answer text.
const AnswersSchema = z.object({
  answers: z.record(z.string(), z.string()),
});

/**
 * Sanitizes a single answer string per spec requirements:
 * - trim() leading/trailing whitespace
 * - strip control characters (\x00-\x1F except \t and \n which are readable)
 * - enforce max 500 character limit
 */
function sanitizeAnswer(raw: string): string {
  return raw
    .trim()
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') // strip control chars except \t(\x09) and \n(\x0A)
    .slice(0, 500);
}

/**
 * POST /api/event-capture/[id]/answers
 * Accepts user Q&A answers, sanitizes them, and triggers background draft generation.
 *
 * Rules:
 * - At least 1 answer required (not all 5, not 0).
 * - Each answer sanitized: trim, strip control chars, max 500 chars.
 * - Validates capture belongs to the active workspace before touching anything.
 * - Returns 202 immediately — does not wait for generation (fire-and-forget to /process).
 * - Returns 409 if capture is already drafting or drafted (idempotency guard).
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = AnswersSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const { answers } = parsed.data;

  // At least 1 non-empty answer required.
  const nonEmpty = Object.values(answers).filter((v) => v.trim().length > 0);
  if (nonEmpty.length === 0) {
    return NextResponse.json(
      { error: 'At least one answer is required' },
      { status: 400 },
    );
  }

  const client = getServerClient();

  // Validate workspace ownership — prevents cross-workspace data access.
  const { data: capture, error: fetchError } = await client.database
    .from('event_captures')
    .select('id, workspace_id')
    .eq('id', params.id)
    .eq('workspace_id', workspaceId)
    .single();

  if (fetchError || !capture) {
    return NextResponse.json({ error: 'Capture not found' }, { status: 404 });
  }

  // Sanitize all answers before storing.
  const sanitizedAnswers: Record<string, string> = {};
  for (const [key, value] of Object.entries(answers)) {
    sanitizedAnswers[key] = sanitizeAnswer(value);
  }

  // Atomic idempotency guard: the status check happens as part of the UPDATE
  // itself (not a separate SELECT beforehand), so two concurrent submissions
  // for the same capture can't both read 'questions_ready' and both proceed.
  // Postgres serializes the two UPDATEs on the row, and only the first sees
  // rows affected. A zero-row result means someone else already won.
  const { data: updatedRows, error: updateError } = await client.database
    .from('event_captures')
    .update({
      answers: sanitizedAnswers,
      status: 'drafting',
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id)
    .eq('workspace_id', workspaceId)
    .neq('status', 'drafting')
    .neq('status', 'drafted')
    .select('id');

  if (updateError) {
    console.error('[event-capture/answers] Update error', updateError);
    return NextResponse.json({ error: 'Failed to save answers' }, { status: 500 });
  }

  if (!updatedRows || updatedRows.length === 0) {
    return NextResponse.json(
      { error: 'Draft generation already started', captureId: params.id },
      { status: 409 },
    );
  }

  // Fire-and-forget to /process — user's 202 has already been set up.
  // The internal route is protected by x-internal-secret = CRON_SECRET.
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const cronSecret = process.env.CRON_SECRET ?? '';

  void fetch(`${appUrl}/api/event-capture/${params.id}/process`, {
    method: 'POST',
    headers: {
      'x-internal-secret': cronSecret,
      'Content-Type': 'application/json',
    },
  }).catch((err) => {
    console.error('[event-capture/answers] fire-and-forget error', err);
  });

  return NextResponse.json({ captureId: params.id }, { status: 202 });
}
