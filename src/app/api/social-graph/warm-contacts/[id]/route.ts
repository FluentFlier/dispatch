import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getWarmContact, updateWarmContactDraft } from '@/lib/social-graph/warm-contacts';

/**
 * GET /api/social-graph/warm-contacts/[id] — full engager record (dossier,
 * draft, nurture stage) for the leads detail pane.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();
  const contact = await getWarmContact(client, user.id, params.id);
  if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 });

  return NextResponse.json({ contact });
}

/**
 * PATCH /api/social-graph/warm-contacts/[id] — save edited connect note.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let draft: string;
  try {
    const body = await request.json();
    if (typeof body?.draft !== 'string' || !body.draft.trim()) {
      return NextResponse.json({ error: 'draft is required' }, { status: 400 });
    }
    draft = body.draft;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const client = getServerClient();
  const contact = await updateWarmContactDraft(client, user.id, params.id, draft);

  if (!contact) {
    return NextResponse.json({ error: 'Contact not found or not editable' }, { status: 404 });
  }

  return NextResponse.json({ ok: true, contact });
}
