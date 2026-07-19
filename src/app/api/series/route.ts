import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId, ensureActiveWorkspaceId } from '@/lib/workspace';
import { errorResponse } from '@/lib/api-errors';
import { z } from 'zod';

const CadenceSchema = z.object({
  days: z.array(z.string()).max(7),
  time: z.string().regex(/^\d{1,2}:\d{2}$/),
  tz: z.string().max(64).optional(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  interval_weeks: z.number().int().min(1).max(8).optional(),
});

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
    pillar: z.string().max(50).optional(),
    total_parts: z.number().int().min(2).max(20).optional(),
    platform: z.enum(['twitter', 'linkedin', 'instagram', 'threads']).optional(),
    cadence: CadenceSchema.optional(),
    auto_publish: z.boolean().optional(),
    status: z.enum(['draft', 'active', 'paused', 'completed']).optional(),
  });

  const parsed = SeriesSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const client = getServerClient();
  // ensure* provisions a solo workspace if the first-login race left none, so
  // series rows never get orphaned with workspace_id = null and hidden by RLS.
  const workspaceId = await ensureActiveWorkspaceId(user.id);
  const { data, error } = await client
    .database.from('series')
    .insert([{
      pillar: 'explainer',
      total_parts: 5,
      status: 'draft',
      ...parsed.data,
      user_id: user.id,
      workspace_id: workspaceId,
    }])
    .select()
    .single();

  if (error) return errorResponse('Could not create series.', 500, error);
  return NextResponse.json({ series: data }, { status: 201 });
}
