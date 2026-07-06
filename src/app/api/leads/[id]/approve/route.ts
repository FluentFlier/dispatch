import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { getLead } from '@/lib/signals/leads/store';
import { sendLeadOutreach } from '@/lib/signals/outreach/send-lead';
import { errorResponse } from '@/lib/api-errors';

/**
 * POST /api/leads/:id/approve
 * One-click approve → live send via the shared safety guard + Unipile path
 * (sendLeadOutreach). Blocks (dry-run, disabled, cap, cooldown, outside hours)
 * come back with the guard reason so the UI can toast/queue; the lead stays
 * `drafted` and can be retried once the window opens or the cap resets.
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
    channel?: 'linkedin_connect' | 'linkedin_dm' | 'x_dm' | 'gmail';
    emailOptIn?: boolean;
  };

  try {
    const client = getServerClient();
    const lead = await getLead(client, workspaceId, params.id);
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });
    if (lead.contact_status === 'no_contact') {
      return NextResponse.json({ error: 'No reachable contact for this lead.' }, { status: 422 });
    }
    if (!lead.outreach?.draft_text) {
      return NextResponse.json({ error: 'Draft the message before approving.' }, { status: 422 });
    }

    const result = await sendLeadOutreach(client, {
      workspaceId,
      userId: user.id,
      leadId: params.id,
      channel: body.channel ?? 'linkedin_connect',
      emailOptIn: body.emailOptIn,
    });

    if (!result.success) {
      // Cooldown/cap → 429 with retry hint; other guard/validation blocks → 422.
      const status = result.retryAfterSeconds ? 429 : 422;
      return NextResponse.json(
        { error: result.error ?? 'Send blocked.', retryAfterSeconds: result.retryAfterSeconds },
        { status },
      );
    }

    return NextResponse.json({ lead: result.lead, externalId: result.externalId });
  } catch (err) {
    return errorResponse('Could not approve lead.', 500, err);
  }
}
