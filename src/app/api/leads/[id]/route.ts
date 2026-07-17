import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { getLead, updateLead } from '@/lib/signals/leads/store';
import { errorResponse } from '@/lib/api-errors';

const patchSchema = z.object({
  action: z.enum(['dismiss', 'snooze']).optional(),
  /** Snooze horizon in days (1, 7, or 30 from the UI). */
  days: z.number().int().min(1).max(30).optional(),
  status: z
    .enum(['new', 'drafted', 'approved', 'sent', 'dismissed', 'resurfaced'])
    .optional(),
  conversion_stage: z
    .enum(['interested', 'meeting_booked', 'not_now', 'won', 'lost'])
    .nullable()
    .optional(),
  needs_reply: z.boolean().optional(),
});

/**
 * PATCH /api/leads/:id
 * Lifecycle updates from the Today tab: dismiss, or snooze (hide until snoozed_until).
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const body = parsed.data;

  try {
    const client = getServerClient();
    const lead = await getLead(client, workspaceId, params.id);
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    if (body.action === 'snooze') {
      const next = new Date(Date.now() + (body.days ?? 7) * 86_400_000);
      await updateLead(client, workspaceId, params.id, {
        // Feed hides the lead until snoozed_until; digest_date keeps the email
        // digest from resurfacing it earlier.
        snoozed_until: next.toISOString(),
        digest_date: next.toISOString().slice(0, 10),
      });
    } else if (body.conversion_stage !== undefined || body.needs_reply !== undefined) {
      const clearsReply =
        body.needs_reply === false ||
        (body.conversion_stage !== undefined && body.conversion_stage !== null);
      await updateLead(client, workspaceId, params.id, {
        ...(body.conversion_stage !== undefined ? { conversion_stage: body.conversion_stage } : {}),
        ...(clearsReply ? { needs_reply: false } : {}),
        ...(body.needs_reply === true ? { needs_reply: true } : {}),
        ...(body.conversion_stage === 'meeting_booked' ? { nurture_stage: 'closed' as const } : {}),
      });
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
