import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { getLead, logLeadEvent, setLeadOutreachStatus } from '@/lib/signals/leads/store';
import { isLinkedInFirstDegree } from '@/lib/gtm/nurture/connection-check';
import { errorResponse } from '@/lib/api-errors';

/**
 * POST /api/leads/:id/check-connection
 *
 * Reply/response tracking for the LinkedIn outreach path: checks whether the
 * prospect has accepted the connection request (1st-degree now). For LinkedIn,
 * the accept is the key response signal and the gate for the follow-up DM step.
 * Reuses the verified isLinkedInFirstDegree primitive - no new Unipile surface.
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

    const contact = lead.primary_contact ?? lead.contacts?.[0] ?? null;
    const identifier = contact?.linkedin_url?.trim() || contact?.provider_id?.trim();
    if (!identifier) {
      return NextResponse.json({ error: 'No LinkedIn identifier for this lead.' }, { status: 422 });
    }

    const connected = await isLinkedInFirstDegree(
      client,
      user.id,
      workspaceId,
      identifier,
      lead.outreach?.linkedin_provider_id,
    );

    if (connected) {
      await logLeadEvent(client, workspaceId, params.id, 'rescored', { action: 'connect_accepted' });
      // Persist acceptance on the outreach row so the follow-up DM step survives
      // a reload (onlyForward: never downgrade a manual replied/closed).
      await setLeadOutreachStatus(client, workspaceId, params.id, 'accepted', true);
    }

    return NextResponse.json({ connected });
  } catch (err) {
    return errorResponse('Could not check connection.', 500, err);
  }
}
