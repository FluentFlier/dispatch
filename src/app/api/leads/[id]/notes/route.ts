import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { getLead } from '@/lib/signals/leads/store';
import { addLeadNote, listLeadNotes } from '@/lib/signals/leads/notes';
import { errorResponse } from '@/lib/api-errors';

const postSchema = z.object({
  body: z.string().min(1).max(4000),
});

/** GET /api/leads/:id/notes — development notes for a lead. */
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

    const notes = await listLeadNotes(client, workspaceId, params.id);
    return NextResponse.json({ notes });
  } catch (err) {
    return errorResponse('Could not load notes.', 500, err);
  }
}

/** POST /api/leads/:id/notes — add a development note (comment, next step, etc.). */
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

    const note = await addLeadNote(client, workspaceId, params.id, user.id, parsed.data.body);
    return NextResponse.json({ note });
  } catch (err) {
    return errorResponse('Could not save note.', 500, err);
  }
}
