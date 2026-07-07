import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { planLeadNurture } from '@/lib/gtm/nurture/plan-lead';
import { getLead, updateLead } from '@/lib/signals/leads/store';
import { applyPlaybookPatch } from '@/lib/gtm/nurture/playbook-patch';
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

// Two PATCH shapes: a single-step status toggle (the living checklist), or a
// free-text edit of the plan (whyThem / angle / step labels).
const stepPatchSchema = z.object({
  stepIndex: z.number().int().min(0),
  status: z.enum(['pending', 'done', 'skipped']),
});
const editPatchSchema = z.object({
  edit: z.object({
    whyThem: z.string().max(2000).optional(),
    angle: z.string().max(2000).optional(),
    stepLabels: z.array(z.string().max(500)).optional(),
  }),
});
const patchSchema = z.union([stepPatchSchema, editPatchSchema]);

/**
 * PATCH /api/leads/:id/playbook
 * Two modes:
 *  - { stepIndex, status }: toggle a single step so the plan is a living
 *    checklist (mark research/comment/connect/dm done) instead of read-only.
 *  - { edit: { whyThem?, angle?, stepLabels? } }: persist user edits to the
 *    plan's free-text fields so a generated plan is never a one-shot dead-end.
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
    if (!playbook?.steps) {
      return NextResponse.json({ error: 'No plan to update' }, { status: 404 });
    }

    const result = applyPlaybookPatch(playbook, parsed.data);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 404 });
    }

    await updateLead(client, workspaceId, params.id, { playbook: result.playbook });

    const updated = await getLead(client, workspaceId, params.id);
    return NextResponse.json({ lead: updated });
  } catch (err) {
    return errorResponse('Could not update playbook step.', 500, err);
  }
}
