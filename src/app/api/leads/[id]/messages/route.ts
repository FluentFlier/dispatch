import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { getLead } from '@/lib/signals/leads/store';
import { listLeadMessages } from '@/lib/signals/leads/messages';
import { errorResponse } from '@/lib/api-errors';

/**
 * GET /api/leads/:id/messages
 * Thread history for a lead (inbound + outbound).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  try {
    const client = getServerClient();
    const lead = await getLead(client, workspaceId, params.id);
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    const messages = await listLeadMessages(client, workspaceId, params.id);
    return NextResponse.json({ messages, needsReply: lead.needs_reply ?? false });
  } catch (err) {
    return errorResponse('Could not load messages.', 500, err);
  }
}
