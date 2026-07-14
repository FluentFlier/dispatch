import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { errorResponse } from '@/lib/api-errors';
import { z } from 'zod';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);

  // Optional status filter: ?status=suggested returns the Suggested pile.
  // When absent, return active ideas only (default workspace behaviour).
  const VALID_STATUSES = ['active', 'suggested', 'dismissed'] as const;
  type IdeaStatus = (typeof VALID_STATUSES)[number];
  const rawStatus = request.nextUrl.searchParams.get('status');
  const statusFilter: IdeaStatus | null = VALID_STATUSES.includes(rawStatus as IdeaStatus)
    ? (rawStatus as IdeaStatus)
    : null;

  let query = client
    .database.from('content_ideas')
    .select('id, idea, pillar, source, source_comment_id, status, notes, priority, created_at, converted, workspace_id, user_id')
    .eq('user_id', user.id)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: false });

  // Scope to the active workspace (rows are backfilled with workspace_id).
  if (workspaceId) query = query.eq('workspace_id', workspaceId);

  // Apply status filter - default to 'active' when no param provided so the
  // Ideas page doesn't surface suggested/dismissed rows in the main list.
  if (statusFilter) {
    query = query.eq('status', statusFilter);
  } else {
    query = query.eq('status', 'active');
  }

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
