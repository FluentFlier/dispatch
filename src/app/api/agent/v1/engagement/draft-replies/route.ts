import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import { assertAgentScope, resolveAgentAuth } from '@/lib/agent-auth/context';
import { draftEngagementReplies } from '@/lib/engagement/inbox';
import { guardAiRequest } from '@/lib/ai-guard';
import { errorResponse } from '@/lib/api-errors';
import { z } from 'zod';

const DraftSchema = z
  .object({
    commentIds: z.array(z.string().uuid()).optional(),
    fast: z.boolean().optional(),
    limit: z.number().int().min(1).max(50).optional(),
  })
  .strict();

/**
 * POST /api/agent/v1/engagement/draft-replies - AI draft comment replies in creator voice.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await resolveAgentAuth(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const scopeErr = assertAgentScope(auth, 'write');
  if (scopeErr) return NextResponse.json({ error: scopeErr }, { status: 403 });

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

  const guard = await guardAiRequest(auth.userId);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const client = getServiceClient();

  try {
    const result = await draftEngagementReplies(client, auth.userId, parsed.data);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return errorResponse('Could not draft replies.', 500, err);
  }
}
