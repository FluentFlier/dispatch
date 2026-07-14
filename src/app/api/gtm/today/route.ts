import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { buildGtmTodaySnapshot } from '@/lib/gtm/today';
import { errorResponse } from '@/lib/api-errors';

/** GET /api/gtm/today - GTM command center snapshot (limits, queue, pipeline). */
export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  try {
    const client = getServerClient();
    const snapshot = await buildGtmTodaySnapshot(client, workspaceId, user.id);
    return NextResponse.json(snapshot);
  } catch (err) {
    return errorResponse('Could not load GTM snapshot.', 500, err);
  }
}
