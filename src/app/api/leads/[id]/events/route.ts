import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { getLead } from '@/lib/signals/leads/store';
import { errorResponse } from '@/lib/api-errors';

/**
 * GET /api/leads/:id/events
 * The lead's activity trail (signal_lead_events), newest first. This table was
 * write-only since launch; the CRM timeline is its first reader.
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

    // Explicit columns on purpose (InsForge select('*') + .eq() quirk).
    const { data, error } = await client.database
      .from('signal_lead_events')
      .select('id, event_type, detail, created_at')
      .eq('workspace_id', workspaceId)
      .eq('lead_id', params.id)
      .limit(100);
    if (error) throw error;

    const events = (data ?? []).sort(
      (a, b) =>
        new Date(String(b.created_at)).getTime() - new Date(String(a.created_at)).getTime(),
    );
    return NextResponse.json({ events });
  } catch (err) {
    return errorResponse('Could not load activity.', 500, err);
  }
}
