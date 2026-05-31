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
  let query = client
    .database.from('weekly_reviews')
    .select('*')
    .eq('user_id', user.id)
    .order('week_start', { ascending: false });
  // Scope to the active workspace (rows are backfilled with workspace_id).
  if (workspaceId) query = query.eq('workspace_id', workspaceId);

  const weekStart = request.nextUrl.searchParams.get('week_start');
  if (weekStart) query = query.eq('week_start', weekStart);

  const { data, error } = await query;
  if (error) return errorResponse('Could not load weekly reviews.', 500, error);

  return NextResponse.json({ reviews: data });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const ReviewSchema = z.object({
    week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
    wins: z.string().max(5000).optional(),
    lessons: z.string().max(5000).optional(),
    goals_next_week: z.string().max(5000).optional(),
    top_post_id: z.string().uuid().optional(),
    notes: z.string().max(5000).optional(),
    metrics: z.record(z.string(), z.unknown()).optional(),
  });

  const parsed = ReviewSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);
  const { data, error } = await client
    .database.from('weekly_reviews')
    .insert([{ ...parsed.data, user_id: user.id, workspace_id: workspaceId }])
    .select()
    .single();

  if (error) return errorResponse('Could not save weekly review.', 500, error);
  return NextResponse.json({ review: data }, { status: 201 });
}
