import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { getLead } from '@/lib/signals/leads/store';
import { resolveLeadContacts } from '@/lib/signals/leads/resolve-contact';
import { errorResponse } from '@/lib/api-errors';

/**
 * POST /api/leads/:id/resolve
 * Re-runs contact resolution for a lead on demand (the "Try to resolve" action
 * on a no_contact lead).
 */
export async function POST(
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

    const res = await resolveLeadContacts(client, workspaceId, lead);
    const updated = await getLead(client, workspaceId, params.id);
    return NextResponse.json({ lead: updated, result: res });
  } catch (err) {
    return errorResponse('Could not resolve contact.', 500, err);
  }
}
