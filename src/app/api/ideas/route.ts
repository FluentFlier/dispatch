import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { errorResponse } from '@/lib/api-errors';
import { z } from 'zod';

export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);

  let query = client
    .database.from('content_ideas')
    .select('*')
    .eq('user_id', user.id)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: false });
  // Scope to the active workspace (rows are backfilled with workspace_id).
  if (workspaceId) query = query.eq('workspace_id', workspaceId);

  const { data, error } = await query;
  if (error) return errorResponse('Could not load ideas.', 500, error);
  return NextResponse.json({ ideas: data });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const IdeaSchema = z.object({
    title: z.string().min(1).max(500),
    description: z.string().max(5000).optional(),
    pillar: z.string().max(200).optional(),
    platform: z.string().max(50).optional(),
    priority: z.number().int().min(0).max(10).optional(),
    status: z.enum(['backlog', 'planned', 'in_progress', 'done']).optional(),
    series_id: z.string().uuid().optional(),
  });

  const parsed = IdeaSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);
  const { data, error } = await client
    .database.from('content_ideas')
    .insert([{ ...parsed.data, user_id: user.id, workspace_id: workspaceId }])
    .select()
    .single();

  if (error) return errorResponse('Could not create idea.', 500, error);
  return NextResponse.json({ idea: data }, { status: 201 });
}
