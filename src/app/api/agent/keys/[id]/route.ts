import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/insforge/server';
import { revokeAgentKey } from '@/lib/agent-auth/store';

/**
 * DELETE /api/agent/keys/[id] — revoke an agent API key (session auth only).
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const revoked = await revokeAgentKey(user.id, params.id);
    if (!revoked) {
      return NextResponse.json({ error: 'Key not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[agent/keys] revoke failed:', err);
    return NextResponse.json({ error: 'Failed to revoke agent key' }, { status: 500 });
  }
}
