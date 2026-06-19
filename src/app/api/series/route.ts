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
    .database.from('series')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  // Scope to the active workspace (rows are backfilled with workspace_id).
  if (workspaceId) query = query.eq('workspace_id', workspaceId);

  const { data, error } = await query;
  if (error) return errorResponse('Could not load series.', 500, error);
  return NextResponse.json({ series: data });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const SeriesSchema = z.object({
    name: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    cadence: z.string().max(100).optional(),
    platform: z.string().max(50).optional(),
    status: z.enum(['active', 'paused', 'completed']).optional(),
  });

  const parsed = SeriesSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);
  const { data, error } = await client
    .database.from('series')
    .insert([{ ...parsed.data, user_id: user.id, workspace_id: workspaceId }])
    .select()
    .single();

  if (error) return errorResponse('Could not create series.', 500, error);
  return NextResponse.json({ series: data }, { status: 201 });
}
