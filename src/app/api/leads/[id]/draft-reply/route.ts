import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { getLead } from '@/lib/signals/leads/store';
import { draftReplyForLead } from '@/lib/signals/outreach/draft-reply';
import { errorResponse } from '@/lib/api-errors';

/**
 * POST /api/leads/:id/draft-reply
 * Drafts a voice-matched reply to the prospect's latest inbound message.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  const body = (await request.json().catch(() => ({}))) as {
    rewriteInstruction?: string;
    polish?: boolean;
  };
  const rewriteInstruction =
    typeof body.rewriteInstruction === 'string' ? body.rewriteInstruction.trim().slice(0, 280) : '';
  const polish = body.polish === true;

  try {
    const client = getServerClient();
    const lead = await getLead(client, workspaceId, params.id);
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    const { draftText, voiceMatchScore } = await draftReplyForLead(
      client,
      user.id,
      workspaceId,
      params.id,
      { rewriteInstruction: rewriteInstruction || null, polish },
    );
    const updated = await getLead(client, workspaceId, params.id);
    return NextResponse.json({ lead: updated, draftText, voiceMatchScore });
  } catch (err) {
    return errorResponse('Could not draft reply.', 500, err);
  }
}
