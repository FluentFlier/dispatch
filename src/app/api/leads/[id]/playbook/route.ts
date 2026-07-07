import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { planLeadNurture } from '@/lib/gtm/nurture/plan-lead';
import { getLead, updateLead } from '@/lib/signals/leads/store';
import type { LeadPlaybook } from '@/lib/signals/types';
import { errorResponse } from '@/lib/api-errors';

/**
 * POST /api/leads/:id/playbook
 * Generate nurture playbook + connect draft; queue connect for auto or manual send.
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
    const result = await planLeadNurture(client, workspaceId, user.id, params.id);
    return NextResponse.json(result);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not plan nurture.';
    const status = msg.includes('not found') ? 404 : msg.includes('contact') ? 422 : 500;
    if (status === 500) return errorResponse(msg, 500, err);
    return NextResponse.json({ error: msg }, { status });
  }
}

const patchSchema = z.object({
  stepIndex: z.number().int().min(0),
  status: z.enum(['pending', 'done', 'skipped']),
});

/**
 * PATCH /api/leads/:id/playbook
 * Toggle a single playbook step's status so the nurture plan is a living
 * checklist (mark research/comment/connect/dm done) instead of read-only.
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

  try {
    const client = getServerClient();
    const lead = await getLead(client, workspaceId, params.id);
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    const playbook = lead.playbook as LeadPlaybook | null;
    if (!playbook?.steps || parsed.data.stepIndex >= playbook.steps.length) {
      return NextResponse.json({ error: 'No such playbook step' }, { status: 404 });
    }

    const steps = playbook.steps.map((s, i) =>
      i === parsed.data.stepIndex ? { ...s, status: parsed.data.status } : s,
    );
    await updateLead(client, workspaceId, params.id, {
      playbook: { ...playbook, steps },
    });

    const updated = await getLead(client, workspaceId, params.id);
    return NextResponse.json({ lead: updated });
  } catch (err) {
    return errorResponse('Could not update playbook step.', 500, err);
  }
}
