import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { listFollowedCompanies, removeFollowedCompany } from '@/lib/signals/leads/store';
import { errorResponse } from '@/lib/api-errors';

/** DELETE /api/leads/followed/:id - unfollow a company. */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  try {
    const client = getServerClient();
    await removeFollowedCompany(client, workspaceId, params.id);
    const followedCompanies = await listFollowedCompanies(client, workspaceId);
    return NextResponse.json({ followedCompanies });
  } catch (err) {
    return errorResponse('Could not unfollow company.', 500, err);
  }
}
