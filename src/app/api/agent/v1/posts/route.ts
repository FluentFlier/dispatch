import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import {
  assertAgentScope,
  getWorkspaceHint,
  resolveAgentAuth,
  resolveAgentWorkspaceId,
} from '@/lib/agent-auth/context';
import { errorResponse } from '@/lib/api-errors';
import { normalizePillars } from '@/lib/pillars';
import { z } from 'zod';

const CreatePostSchema = z
  .object({
    title: z.string().min(1),
    pillar: z.string().min(1).optional(),
    pillars: z.array(z.string()).optional(),
    platform: z.string().min(1),
    status: z.string().optional(),
    script: z.string().nullable().optional(),
    caption: z.string().nullable().optional(),
    hashtags: z.string().nullable().optional(),
    hook: z.string().nullable().optional(),
    scheduled_date: z.string().nullable().optional(),
  })
  .strict()
  .refine((d) => Boolean(d.pillar) || (d.pillars && d.pillars.length > 0), {
    message: 'At least one pillar is required',
    path: ['pillar'],
  });

/**
 * GET /api/agent/v1/posts - list library posts.
 * POST /api/agent/v1/posts - create a draft post.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await resolveAgentAuth(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const scopeErr = assertAgentScope(auth, 'read');
  if (scopeErr) return NextResponse.json({ error: scopeErr }, { status: 403 });

  const client = getServiceClient();
  const workspaceId = await resolveAgentWorkspaceId(auth.userId, getWorkspaceHint(request));
  const params = request.nextUrl.searchParams;

  let query = client.database
    .from('posts')
    .select('*')
    .eq('user_id', auth.userId)
    .order('created_at', { ascending: false });

  if (workspaceId) query = query.eq('workspace_id', workspaceId);

  const status = params.get('status');
  if (status) query = query.eq('status', status);

  const platform = params.get('platform');
  if (platform) query = query.eq('platform', platform);

  const limit = Math.min(parseInt(params.get('limit') ?? '25', 10), 100);
  query = query.limit(limit);

  const { data, error } = await query;
  if (error) return errorResponse('Could not load posts.', 500, error);

  return NextResponse.json({ posts: data ?? [], count: data?.length ?? 0 });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const auth = await resolveAgentAuth(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const scopeErr = assertAgentScope(auth, 'write');
  if (scopeErr) return NextResponse.json({ error: scopeErr }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = CreatePostSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const client = getServiceClient();
  const workspaceId = await resolveAgentWorkspaceId(auth.userId, getWorkspaceHint(request));
  const { pillar, pillars, pillar_weights } = normalizePillars(parsed.data);

  const { data, error } = await client.database
    .from('posts')
    .insert([
      {
        ...parsed.data,
        pillar,
        pillars,
        pillar_weights,
        user_id: auth.userId,
        workspace_id: workspaceId,
      },
    ])
    .select()
    .single();

  if (error) return errorResponse('Could not create post.', 500, error);

  return NextResponse.json({ post: data }, { status: 201 });
}
