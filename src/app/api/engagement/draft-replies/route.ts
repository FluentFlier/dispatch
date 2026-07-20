import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { draftEngagementReplies } from '@/lib/engagement/inbox';
import { guardAiRequest } from '@/lib/ai-guard';
import { errorResponse } from '@/lib/api-errors';
import { z } from 'zod';

const DraftSchema = z
  .object({
    commentIds: z.array(z.string().uuid()).optional(),
    postId: z.string().uuid().optional(),
    fast: z.boolean().optional(),
    limit: z.number().int().min(1).max(50).optional(),
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

  const parsed = DraftSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const guard = await guardAiRequest(user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const client = getServerClient();

  try {
    const result = await draftEngagementReplies(client, user.id, parsed.data);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return errorResponse('Could not draft replies.', 500, err);
  }
}
