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

/**
 * PATCH /api/leads/:id/draft
 * Autosaves the user's EDITED draft text (debounced from the textarea) so
 * edits survive navigation, logout, or a closed tab. Saved to
 * edited_draft_text - draft_text stays the model's original so the
 * edit-learning pair (model draft vs what was actually sent) is preserved.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  const body = (await request.json().catch(() => ({}))) as { draftText?: string };
  if (typeof body.draftText !== 'string') {
    return NextResponse.json({ error: 'draftText is required.' }, { status: 400 });
  }
  const edited = body.draftText.slice(0, 4000);

  try {
    const client = getServerClient();
    const lead = await getLead(client, workspaceId, params.id);
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

    // Explicit columns on purpose (InsForge select('*') + .eq() quirk).
    const { data: existing } = await client.database
      .from('signal_outreach')
      .select('id')
      .eq('lead_id', params.id)
      .limit(1);
    const rowId = (existing?.[0] as { id: string } | undefined)?.id;

    if (rowId) {
      const { error } = await client.database
        .from('signal_outreach')
        .update({ edited_draft_text: edited, updated_at: new Date().toISOString() })
        .eq('id', rowId);
      if (error) throw error;
    } else {
      // User typed a draft by hand before ever generating one - still persist.
      const { error } = await client.database.from('signal_outreach').insert({
        workspace_id: workspaceId,
        lead_id: params.id,
        channel: 'linkedin_connect',
        status: 'draft',
        draft_text: '',
        edited_draft_text: edited,
      });
      if (error) throw error;
    }

    return NextResponse.json({ saved: true });
  } catch (err) {
    return errorResponse('Could not save draft.', 500, err);
  }
}
