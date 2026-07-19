import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { errorResponse } from '@/lib/api-errors';
import { z } from 'zod';

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);
  let query = client
    .database.from('series')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', user.id);
  if (workspaceId) query = query.eq('workspace_id', workspaceId);
  const { data, error } = await query.single();

  if (error) return errorResponse('Series not found.', 404, error);
  return NextResponse.json({ series: data });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const SeriesUpdateSchema = z.object({
    name: z.string().min(1).max(200).optional(),
    description: z.string().max(2000).optional(),
    pillar: z.string().max(50).optional(),
    total_parts: z.number().int().min(2).max(20).optional(),
    platform: z.enum(['twitter', 'linkedin', 'instagram', 'threads']).optional(),
    cadence: z.object({
      days: z.array(z.string()).max(7),
      time: z.string().regex(/^\d{1,2}:\d{2}$/),
      tz: z.string().max(64).optional(),
      start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      interval_weeks: z.number().int().min(1).max(8).optional(),
    }).optional(),
    auto_publish: z.boolean().optional(),
    status: z.enum(['draft', 'active', 'paused', 'completed']).optional(),
  });

  const parsed = SeriesUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);
  let query = client
    .database.from('series')
    .update(parsed.data)
    .eq('id', params.id)
    .eq('user_id', user.id);
  if (workspaceId) query = query.eq('workspace_id', workspaceId);
  const { data, error } = await query.select().single();

  if (error) return errorResponse('Could not update series.', 500, error);
  return NextResponse.json({ series: data });
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
    .database.from('series')
    .delete()
    .eq('id', params.id)
    .eq('user_id', user.id);
  if (workspaceId) query = query.eq('workspace_id', workspaceId);
  const { error } = await query;

  if (error) return errorResponse('Could not delete series.', 500, error);
  return NextResponse.json({ success: true });
}
