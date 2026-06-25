import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { errorResponse } from '@/lib/api-errors';
import { z } from 'zod';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  // L5 adds 'active' and 'dismissed' to support the Suggested pile promote/dismiss flow.
  // The status enum covers both the original workflow statuses and the L5 signal statuses.
  const IdeaUpdateSchema = z.object({
    title: z.string().min(1).max(500).optional(),
    description: z.string().max(5000).optional(),
    pillar: z.string().max(200).optional(),
    platform: z.string().max(50).optional(),
    priority: z.number().int().min(0).max(10).optional(),
    status: z.enum(['backlog', 'planned', 'in_progress', 'done', 'active', 'suggested', 'dismissed']).optional(),
    series_id: z.string().uuid().optional(),
  });

  const parsed = IdeaUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);
  let query = client
    .database.from('content_ideas')
    .update(parsed.data)
    .eq('id', params.id)
    .eq('user_id', user.id);
  if (workspaceId) query = query.eq('workspace_id', workspaceId);
  const { data, error } = await query.select().single();

  if (error) return errorResponse('Could not update idea.', 500, error);
  return NextResponse.json({ idea: data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);
  let query = client
    .database.from('content_ideas')
    .delete()
    .eq('id', params.id)
    .eq('user_id', user.id);
  if (workspaceId) query = query.eq('workspace_id', workspaceId);
  const { error } = await query;

  if (error) return errorResponse('Could not delete idea.', 500, error);
  return NextResponse.json({ success: true });
}
