import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { z } from 'zod';
import { triggerAutoOptimize } from '@/lib/auto-optimize';
import { normalizePillars } from '@/lib/pillars';

const UpdatePostSchema = z.object({
  title: z.string().min(1).optional(),
  pillar: z.string().optional(),
  pillars: z.array(z.string()).optional(),
  pillar_weights: z.record(z.string(), z.number()).optional(),
  platform: z.string().optional(),
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
  scheduled_publish_at: z.string().nullable().optional(),
  image_url: z.string().nullable().optional(),
  voice_match_score: z.number().int().min(0).max(100).nullable().optional(),
  ai_score: z.number().int().min(0).max(100).nullable().optional(),
  voice_evaluation: z.record(z.string(), z.unknown()).nullable().optional(),
  used_hook_ids: z.array(z.string()).optional(),
  pipeline_stages: z.array(z.string()).optional(),
  updated_at: z.string().optional(),
  // Ephemeral display-only fields with no column on `posts`; accept then strip
  // before update so the editor never 400s on a forgiving payload.
  hook_explanations: z.array(z.unknown()).optional(),
  humanize_passes: z.array(z.string()).optional(),
}).strict();

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();
  const { data, error } = await client
    .database.from('posts')
    .select('*')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json({ post: data });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = UpdatePostSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const client = getServerClient();

  // Fetch existing post to compare content for auto-optimize
  const { data: existingPost } = await client
    .database.from('posts')
    .select('script, caption, workspace_id')
    .eq('id', params.id)
    .eq('user_id', user.id)
    .single();

  // When pillar/pillars/weights are being changed, keep all three in sync and
  // re-derive the primary as the highest-weight pillar.
  const { hook_explanations: _hookExplanations, humanize_passes: _humanizePasses, ...updatable } = parsed.data;
  const updatePayload: Record<string, unknown> = { ...updatable };
  if (
    parsed.data.pillar !== undefined ||
    parsed.data.pillars !== undefined ||
    parsed.data.pillar_weights !== undefined
  ) {
    const { pillar, pillars, pillar_weights } = normalizePillars(parsed.data);
    updatePayload.pillar = pillar;
    updatePayload.pillars = pillars;
    updatePayload.pillar_weights = pillar_weights;
  }

  const { data, error } = await client
    .database.from('posts')
    .update(updatePayload)
    .eq('id', params.id)
    .eq('user_id', user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Trigger auto-optimize only if script or caption actually changed
  const scriptChanged =
    parsed.data.script !== undefined &&
    parsed.data.script !== (existingPost?.script ?? null);
  const captionChanged =
    parsed.data.caption !== undefined &&
    parsed.data.caption !== (existingPost?.caption ?? null);
  const hasContentChange = scriptChanged || captionChanged;

  if (hasContentChange && data) {
    const content = parsed.data.script || parsed.data.caption;
    if (content && data.platform) {
      // Fire-and-forget: in-process (no HTTP / cookie dependency)
      triggerAutoOptimize({
        userId: user.id,
        postId: params.id,
        content,
        sourcePlatform: data.platform,
        workspaceId: data.workspace_id ?? existingPost?.workspace_id ?? null,
      }).catch((err) => {
        console.error('[posts] Auto-optimize trigger error:', err);
      });
    }
  }

  return NextResponse.json({ post: data });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();
  const { error } = await client
    .database.from('posts')
    .delete()
    .eq('id', params.id)
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
