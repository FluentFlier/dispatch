import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { getLead, logLeadEvent, setLeadOutreachStatus } from '@/lib/signals/leads/store';
import { errorResponse } from '@/lib/api-errors';

const postSchema = z.object({
  stage: z.enum(['accepted', 'replied', 'closed']),
});

/**
 * POST /api/leads/:id/outreach-stage
 *
 * Manually advance a directory lead's outreach lifecycle past "sent" — the
 * stages the data model already supports (accepted → replied → closed) but the
 * UI previously couldn't reach, so outreach dead-ended at "sent". Persists on
 * the outreach row and logs an audit event. Returns the refreshed lead.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  const parsed = postSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  try {
    const client = getServerClient();
    const lead = await getLead(client, workspaceId, params.id);
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    const result = await setLeadOutreachStatus(client, workspaceId, params.id, parsed.data.stage);
    if (result === null) {
      return NextResponse.json(
        { error: 'Draft and send outreach before advancing its stage.' },
        { status: 422 },
      );
    }

    await logLeadEvent(client, workspaceId, params.id, 'rescored', {
      action: `outreach_${parsed.data.stage}`,
    });

    const updated = await getLead(client, workspaceId, params.id);
    return NextResponse.json({ lead: updated });
  } catch (err) {
    return errorResponse('Could not update outreach stage.', 500, err);
  }
}
