import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { z } from 'zod';
import { triggerAutoOptimize } from '@/lib/auto-optimize';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { errorResponse } from '@/lib/api-errors';
import { normalizePillars } from '@/lib/pillars';

const CreatePostSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  // Either a single pillar (legacy) or a pillars[] array; normalized server-side.
  pillar: z.string().min(1).optional(),
  pillars: z.array(z.string()).optional(),
  platform: z.string().min(1, 'Platform is required'),
  status: z.string().optional(),
  script: z.string().nullable().optional(),
  caption: z.string().nullable().optional(),
  hashtags: z.string().nullable().optional(),
  hook: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  scheduled_date: z.string().nullable().optional(),
  posted_date: z.string().nullable().optional(),
  series_id: z.string().nullable().optional(),
  series_position: z.number().nullable().optional(),
  views: z.number().nullable().optional(),
  likes: z.number().nullable().optional(),
  saves: z.number().nullable().optional(),
  comments: z.number().nullable().optional(),
  shares: z.number().nullable().optional(),
  follows_gained: z.number().nullable().optional(),
  variant_group_id: z.string().uuid().nullable().optional(),
  source_platform: z.string().nullable().optional(),
  image_url: z.string().nullable().optional(),
  voice_match_score: z.number().int().min(0).max(100).nullable().optional(),
  ai_score: z.number().int().min(0).max(100).nullable().optional(),
  voice_evaluation: z.record(z.string(), z.unknown()).nullable().optional(),
}).strict().refine((d) => Boolean(d.pillar) || (d.pillars && d.pillars.length > 0), {
  message: 'At least one pillar is required',
  path: ['pillar'],
});

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);
  const params = request.nextUrl.searchParams;

  let query = client
    .database.from('posts')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  // Scope to the active workspace (rows are backfilled with workspace_id).
  if (workspaceId) query = query.eq('workspace_id', workspaceId);

  const pillar = params.get('pillar');
  // Match posts that contain this pillar anywhere in their pillars[] array.
  // Falls back to the primary pillar column for any legacy rows.
  if (pillar) query = query.contains('pillars', [pillar]);

  const status = params.get('status');
  if (status) query = query.eq('status', status);

  const platform = params.get('platform');
  if (platform) query = query.eq('platform', platform);

  const seriesId = params.get('series_id');
  if (seriesId) query = query.eq('series_id', seriesId);

  // Pagination
  const page = parseInt(params.get('page') ?? '1', 10);
  const limit = Math.min(parseInt(params.get('limit') ?? '50', 10), 100);
  const from = (page - 1) * limit;
  const to = from + limit - 1;
  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) return errorResponse('Could not load posts.', 500, error);

  return NextResponse.json({ posts: data, page, limit, total: count ?? data?.length ?? 0 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = CreatePostSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);
  // Keep pillar (primary) and pillars[] in sync so legacy readers keep working.
  const { pillar, pillars } = normalizePillars(parsed.data);
  const { data, error } = await client
    .database.from('posts')
    .insert([{ ...parsed.data, pillar, pillars, user_id: user.id, workspace_id: workspaceId }])
    .select()
    .single();

  if (error) return errorResponse('Could not create post.', 500, error);

  // Trigger auto-optimize in background if content is present
  const content = parsed.data.script || parsed.data.caption;
  if (content && data?.id) {
    const origin = request.nextUrl.origin;
    const cookieHeader = request.headers.get('cookie') ?? '';
    // Fire-and-forget: do not await
    triggerAutoOptimize({
      userId: user.id,
      postId: data.id,
      content,
      sourcePlatform: parsed.data.platform,
      requestCookies: cookieHeader,
      origin,
    }).catch((err) => {
      console.error('[posts] Auto-optimize trigger error:', err);
    });
  }

  return NextResponse.json({ post: data }, { status: 201 });
}
