import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { draftWarmContactOutreach } from '@/lib/social-graph/warm-contacts';
import { guardAiRequest } from '@/lib/ai-guard';

/**
 * POST /api/social-graph/warm-contacts/[id]/draft - AI connection note in your voice.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const guard = await guardAiRequest(user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);

  try {
    const result = await draftWarmContactOutreach(
      client,
      user.id,
      workspaceId,
      params.id,
    );
    if (!result.contact) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, draft: result.draft, contact: result.contact });
  } catch (err) {
    console.error('[social-graph/warm-contacts/draft]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Draft failed' },
      { status: 500 },
    );
  }
}
