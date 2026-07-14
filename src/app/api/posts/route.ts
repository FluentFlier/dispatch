import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { triggerAutoOptimize } from '@/lib/auto-optimize';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { errorResponse } from '@/lib/api-errors';
import { normalizePillars } from '@/lib/pillars';
import { CreatePostSchema } from '@/lib/posts-schema';
import {
  checkCoreSchemaSetup,
  isMissingRelationError,
  isSchemaMismatchError,
  setupRequiredResponse,
} from '@/lib/db/setup-gate';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();

  try {
    const setup = await checkCoreSchemaSetup(client);
    if (!setup.ok) {
      return setupRequiredResponse(setup.missing, {
        error: 'Content OS database is not provisioned on this InsForge project',
        detail: 'Link a clean project and apply db/APPLY_ORDER.md (core steps 1–10)',
      });
    }

    const workspaceId = await getActiveWorkspaceId(user.id);
    const params = request.nextUrl.searchParams;

    // Newest post first. Imported posts all share one import-batch created_at, so
    // ordering by created_at alone scrambles their real chronology — sort by the
    // actual publish date first (nulls last so drafts/scheduled fall below), then
    // created_at as the tiebreaker for same-day posts and undated drafts.
    let query = client
      .database.from('posts')
      .select('*')
      .eq('user_id', user.id)
      .order('posted_date', { ascending: false, nullsFirst: false })
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
    if (error) {
      if (isMissingRelationError(error) || isSchemaMismatchError(error)) {
        return setupRequiredResponse(['posts'], {
          error: 'Content OS database is not provisioned on this InsForge project',
          detail: 'Link a clean project and apply db/APPLY_ORDER.md (core steps 1–10)',
        });
      }
      return errorResponse('Could not load posts.', 500, error);
    }

    return NextResponse.json({ posts: data, page, limit, total: count ?? data?.length ?? 0 });
  } catch (err) {
    if (isMissingRelationError(err) || isSchemaMismatchError(err)) {
      return setupRequiredResponse(['posts'], {
        error: 'Content OS database is not provisioned on this InsForge project',
        detail: 'Link a clean project and apply db/APPLY_ORDER.md (core steps 1–10)',
      });
    }
    return errorResponse('Could not load posts.', 500, err);
  }
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
  // Keep pillar (primary), pillars[], and weights in sync so legacy readers keep
  // working and the primary is always the highest-weight pillar.
  const { pillar, pillars, pillar_weights } = normalizePillars(parsed.data);
  // Drop ephemeral display-only fields that have no column on `posts`.
  const { hook_explanations: _hookExplanations, humanize_passes: _humanizePasses, ...insertable } = parsed.data;
  const { data, error } = await client
    .database.from('posts')
    .insert([{ ...insertable, pillar, pillars, pillar_weights, user_id: user.id, workspace_id: workspaceId }])
    .select()
    .single();

  if (error) return errorResponse('Could not create post.', 500, error);

  // Trigger auto-optimize in background if content is present
  const content = parsed.data.script || parsed.data.caption;
  if (content && data?.id) {
    // Fire-and-forget: in-process (no HTTP / cookie dependency)
    triggerAutoOptimize({
      userId: user.id,
      postId: data.id,
      content,
      sourcePlatform: parsed.data.platform,
      workspaceId,
    }).catch((err) => {
      console.error('[posts] Auto-optimize trigger error:', err);
    });
  }

  return NextResponse.json({ post: data }, { status: 201 });
}
