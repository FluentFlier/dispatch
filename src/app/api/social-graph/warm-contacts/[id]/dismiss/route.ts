import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { dismissWarmContact } from '@/lib/social-graph/warm-contacts';

/**
 * POST /api/social-graph/warm-contacts/[id]/dismiss — remove from triage queue.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();
  const ok = await dismissWarmContact(client, user.id, params.id);

  if (!ok) {
    return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
