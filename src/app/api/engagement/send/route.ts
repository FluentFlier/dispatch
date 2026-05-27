import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { sendEngagementReplies } from '@/lib/engagement/inbox';
import { z } from 'zod';

const SendSchema = z
  .object({
    queueIds: z.array(z.string().uuid()).optional(),
    approveFirst: z.boolean().optional(),
    draftOverrides: z.record(z.string().uuid(), z.string()).optional(),
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

  const client = getServerClient();

  try {
    const result = await sendEngagementReplies(client, user.id, parsed.data);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error('Engagement send error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Send failed' },
      { status: 500 },
    );
  }
}
