import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { isEnabled } from '@/lib/feature-flags';
import { syncWorkspaceSignals } from '@/lib/signals/sync';
import { errorResponse } from '@/lib/api-errors';

export const maxDuration = 60;

/** POST /api/signals/sync — manual sync for authenticated workspace */
export async function POST(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  try {
    const client = getServerClient();

    if (!(await isEnabled(client, 'signals_engine'))) {
      return NextResponse.json(
        { error: 'Signals is not enabled for this workspace.' },
        { status: 503 },
      );
    }

    const result = await syncWorkspaceSignals(client, workspaceId);
    return NextResponse.json({ result });
  } catch (err) {
    return errorResponse('Sync failed.', 500, err);
  }
}
