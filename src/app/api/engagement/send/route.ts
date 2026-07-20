import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { sendEngagementReplies } from '@/lib/engagement/inbox';
import { unipileCommentsAvailable } from '@/lib/engagement/unipile-comments';
import { z } from 'zod';

const SendSchema = z
  .object({
    queueIds: z.array(z.string().uuid()).optional(),
    approveFirst: z.boolean().optional(),
    draftOverrides: z.record(z.string().uuid(), z.string()).optional(),
    manualDrafts: z.record(z.string().uuid(), z.string()).optional(),
  })
  .strict();

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // empty body allowed
  }

  const parsed = SendSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  if (!unipileCommentsAvailable()) {
    return NextResponse.json(
      {
        error:
          'Cannot send replies: Unipile is not configured. Connect LinkedIn or X in Settings after the provider is provisioned.',
        canSend: false,
        sent: 0,
        failed: 0,
        stubbed: 0,
      },
      { status: 503 },
    );
  }

  const client = getServerClient();

  try {
    const result = await sendEngagementReplies(client, user.id, parsed.data);
    if (result.stubbed > 0 && result.sent === 0) {
      return NextResponse.json(
        {
          ok: false,
          canSend: false,
          error:
            result.errors[0] ??
            'Replies were not sent. Connect the social account in Settings.',
          ...result,
        },
        { status: 422 },
      );
    }
    return NextResponse.json({ ok: true, canSend: true, ...result });
  } catch (err) {
    console.error('Engagement send error:', err);
    const message = err instanceof Error ? err.message : 'Send failed';
    const unavailable =
      (typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: unknown }).code === 'UNIPILE_UNAVAILABLE') ||
      /unipile is not configured/i.test(message);
    return NextResponse.json(
      { error: message, canSend: false },
      { status: unavailable ? 503 : 500 },
    );
  }
}
