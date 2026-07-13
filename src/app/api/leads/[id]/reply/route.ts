import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { getLead } from '@/lib/signals/leads/store';
import { sendLeadReply } from '@/lib/signals/outreach/send-reply';
import { errorResponse } from '@/lib/api-errors';

/**
 * POST /api/leads/:id/reply
 * Sends the drafted (or edited) reply in the active LinkedIn thread.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  const body = (await request.json().catch(() => ({}))) as { messageText?: string };
  const messageText = typeof body.messageText === 'string' ? body.messageText.trim() : undefined;

  try {
    const client = getServerClient();
    const lead = await getLead(client, workspaceId, params.id);
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    if (!lead.outreach?.draft_text && !messageText) {
      return NextResponse.json({ error: 'Draft the reply before sending.' }, { status: 422 });
    }

    const result = await sendLeadReply(client, {
      workspaceId,
      userId: user.id,
      leadId: params.id,
      messageText,
    });

    if (!result.success) {
      const status = result.retryAfterSeconds ? 429 : 422;
      return NextResponse.json(
        { error: result.error ?? 'Send blocked.', retryAfterSeconds: result.retryAfterSeconds },
        { status },
      );
    }

    return NextResponse.json({ lead: result.lead, externalId: result.externalId });
  } catch (err) {
    return errorResponse('Could not send reply.', 500, err);
  }
}
