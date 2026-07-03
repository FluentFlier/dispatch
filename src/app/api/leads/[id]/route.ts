import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { getLead, updateLead } from '@/lib/signals/leads/store';
import { errorResponse } from '@/lib/api-errors';
import type { LeadStatus } from '@/lib/signals/types';

/**
 * PATCH /api/leads/:id
 * Lifecycle updates from the Today tab: dismiss, or snooze (push digest_date +1).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  const body = (await request.json().catch(() => ({}))) as {
    action?: 'dismiss' | 'snooze';
    status?: LeadStatus;
  };

  try {
    const client = getServerClient();
    const lead = await getLead(client, workspaceId, params.id);
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    if (body.action === 'snooze') {
      const next = new Date();
      next.setDate(next.getDate() + 1);
      await updateLead(client, workspaceId, params.id, { digest_date: next.toISOString().slice(0, 10) });
    } else {
      await updateLead(client, workspaceId, params.id, {
        lead_status: body.status ?? 'dismissed',
      });
    }

    const updated = await getLead(client, workspaceId, params.id);
    return NextResponse.json({ lead: updated });
  } catch (err) {
    return errorResponse('Could not update lead.', 500, err);
  }
}
