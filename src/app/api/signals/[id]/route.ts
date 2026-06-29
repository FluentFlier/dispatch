import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { getEvent, updateEventStatus } from '@/lib/signals/store';
import { errorResponse } from '@/lib/api-errors';

const PatchSchema = z.object({
  status: z.enum(['dismissed']),
}).strict();

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
    const event = await getEvent(client, workspaceId, params.id);
    if (!event) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ event });
  } catch (err) {
    return errorResponse('Could not load signal.', 500, err);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  let body: z.infer<typeof PatchSchema>;
  try {
    body = PatchSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const client = getServerClient();
    await updateEventStatus(client, workspaceId, params.id, body.status);
    const event = await getEvent(client, workspaceId, params.id);
    return NextResponse.json({ event });
  } catch (err) {
    return errorResponse('Could not update signal.', 500, err);
  }
}
