import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { getLead } from '@/lib/signals/leads/store';
import { fetchProspectLinkedInPost } from '@/lib/gtm/nurture/linkedin-posts';
import { queueLeadCommentAction } from '@/lib/gtm/nurture/comment-task';
import { errorResponse } from '@/lib/api-errors';

/**
 * POST /api/leads/:id/comment
 * Finds the lead contact's recent LinkedIn post, drafts a voice comment, and
 * queues it for the engagement worker at a random future time inside working
 * hours (never instant bursts). The worker posts with ≥120s gaps between
 * actions and enforces per-account daily caps, per Unipile humanization guidance.
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
    if (!contact?.linkedin_url?.trim()) {
      return NextResponse.json(
        { error: 'This lead has no LinkedIn profile to comment on.' },
        { status: 422 },
      );
    }

    const post = await fetchProspectLinkedInPost(client, workspaceId, user.id, lead);
    if (!post) {
      return NextResponse.json(
        { error: 'No recent post found for this contact to comment on.' },
        { status: 422 },
      );
    }

    const result = await queueLeadCommentAction(client, workspaceId, user.id, lead, post);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse('Could not queue comment.', 500, err);
  }
}
