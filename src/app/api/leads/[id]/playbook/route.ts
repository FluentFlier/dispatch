import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { planLeadNurture } from '@/lib/gtm/nurture/plan-lead';
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
