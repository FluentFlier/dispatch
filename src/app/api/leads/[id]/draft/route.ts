import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { getLead } from '@/lib/signals/leads/store';
import { draftOutreachForLead } from '@/lib/signals/outreach/draft-lead';
import { errorResponse } from '@/lib/api-errors';
import type { OutreachChannel } from '@/lib/signals/types';

/**
 * POST /api/leads/:id/draft
 * Generates (or regenerates) the outreach draft for a lead in the creator's voice.
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
    channel?: OutreachChannel;
    rewriteInstruction?: string;
    polish?: boolean;
  };
  // Trim + cap the free-text rewrite instruction so a stray paste can't bloat
  // the prompt (and latency). Empty means a plain regenerate.
  const rewriteInstruction =
    typeof body.rewriteInstruction === 'string' ? body.rewriteInstruction.trim().slice(0, 280) : '';
  // Polish = opt in to the full voice + critique loop (slower, higher fidelity).
  const polish = body.polish === true;

  try {
    const client = getServerClient();
    const lead = await getLead(client, workspaceId, params.id);
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    const { draftText, voiceMatchScore } = await draftOutreachForLead(
      client,
      user.id,
      workspaceId,
      lead,
      body.channel ?? 'linkedin_connect',
      { rewriteInstruction: rewriteInstruction || null, polish },
    );
    const updated = await getLead(client, workspaceId, params.id);
    return NextResponse.json({ lead: updated, draftText, voiceMatchScore });
  } catch (err) {
    return errorResponse('Could not draft outreach.', 500, err);
  }
}
