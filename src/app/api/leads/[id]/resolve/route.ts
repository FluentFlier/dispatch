import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { getDirectorySettings, getLead } from '@/lib/signals/leads/store';
import { resolveLeadContacts } from '@/lib/signals/leads/resolve-contact';
import { errorResponse } from '@/lib/api-errors';
import { inferPersonaTarget } from '@/lib/signals/leads/persona-fit';

/**
 * POST /api/leads/:id/resolve
 * Re-runs contact resolution for a lead on demand (the "Try to resolve" action
 * on a no_contact lead).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  // force: a user "Rescan" re-pulls fresh contact data even if already resolved.
  const body = (await request.json().catch(() => ({}))) as { force?: boolean };

  try {
    const client = getServerClient();
    const lead = await getLead(client, workspaceId, params.id);
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    const settings = await getDirectorySettings(client, workspaceId);
    const persona = inferPersonaTarget(settings.icp_description);

    const res = await resolveLeadContacts(client, workspaceId, lead, {
      force: body.force === true,
      persona,
    });
    const updated = await getLead(client, workspaceId, params.id);
    return NextResponse.json({ lead: updated, result: res });
  } catch (err) {
    return errorResponse('Could not resolve contact.', 500, err);
  }
}
