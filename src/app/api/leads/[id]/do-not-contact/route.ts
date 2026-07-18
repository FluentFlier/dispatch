import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { getLead } from '@/lib/signals/leads/store';
import { errorResponse } from '@/lib/api-errors';

/**
 * POST /api/leads/:id/do-not-contact
 * "Never contact again" (Task 11): inserts the lead's primary contact identity
 * into do_not_contact (reason 'user_marked'), so checkPriorContact (Task 9)
 * hard-blocks any future send to that person across every lead sharing the
 * identity - not just an overridable duplicate warning. A lead with no
 * resolved identity has nothing to block, so it no-ops instead of inserting
 * an empty row.
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
    const linkedin_provider_id = contact?.provider_id ?? null;
    const linkedin_url = contact?.linkedin_url ?? null;
    const x_handle = contact?.x_handle ?? null;
    const email = contact?.email ?? lead.contacts?.find((c) => c.email)?.email ?? null;

    if (!linkedin_provider_id && !linkedin_url && !x_handle && !email) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const { error } = await client.database
      .from('do_not_contact')
      .insert([
        {
          workspace_id: workspaceId,
          linkedin_provider_id,
          linkedin_url,
          x_handle,
          email,
          reason: 'user_marked',
        },
      ])
      .select('id');
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse('Could not add to do-not-contact list.', 500, err);
  }
}
