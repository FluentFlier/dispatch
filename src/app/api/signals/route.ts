import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { listEvents } from '@/lib/signals/store';
import { errorResponse } from '@/lib/api-errors';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) {
    return NextResponse.json({ error: 'No active workspace' }, { status: 400 });
  }

  const params = request.nextUrl.searchParams;
  const status = params.get('status') ?? undefined;
  const signalType = params.get('signal_type') ?? undefined;
  const limit = parseInt(params.get('limit') ?? '50', 10);

  try {
    const client = getServerClient();
    const events = await listEvents(client, workspaceId, { status, signalType, limit });
    return NextResponse.json({ events });
  } catch (err) {
    return errorResponse('Could not load signals.', 500, err);
  }
}
