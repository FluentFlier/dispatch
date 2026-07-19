import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { errorResponse } from '@/lib/api-errors';
import { guardAiRequest } from '@/lib/ai-guard';
import { LlmError } from '@/lib/llm';
import { z } from 'zod';
import { loadSeries } from '@/lib/series/db';
import { planSeriesArc } from '@/lib/series/plan-arc';

export const maxDuration = 120;

const Body = z.object({ numParts: z.number().int().min(2).max(20).optional() });

/**
 * Generates the series arc and persists each part as a draft `posts` row
 * (status 'idea', series_position 1..N). Re-planning replaces any existing
 * not-yet-posted parts so positions stay clean. Parts start unapproved, so the
 * confirm-all gate downstream can never schedule an unreviewed part.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown = {};
  try { body = await request.json(); } catch { /* empty body ok */ }
  const parsed = Body.safeParse(body ?? {});
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const guard = await guardAiRequest(user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);
  const series = await loadSeries(client, params.id, user.id, workspaceId);
  if (!series) return NextResponse.json({ error: 'Series not found' }, { status: 404 });

  const numParts = parsed.data.numParts ?? series.total_parts ?? 5;

  try {
    const parts = await planSeriesArc({
      client,
      seriesId: series.id,
      userId: user.id,
      workspaceId,
      concept: series.name,
      description: series.description,
      numParts,
      platform: series.platform,
    });

    // Replace prior un-posted parts so re-planning doesn't leave stale positions.
    await client.database
      .from('posts')
      .delete()
      .eq('series_id', series.id)
      .eq('user_id', user.id)
      .neq('status', 'posted');

    const platform = series.platform ?? 'linkedin';
    const postRows = parts.map((p) => ({
      user_id: user.id,
      workspace_id: workspaceId,
      title: p.title,
      pillar: series.pillar,
      platform,
      status: 'idea',
      hook: p.hook || null,
      notes: [p.core_point && `Core: ${p.core_point}`, p.bridge && `Bridge: ${p.bridge}`]
        .filter(Boolean).join('\n') || null,
      series_id: series.id,
      series_position: p.position,
      series_approved: false,
    }));

    const { error: insertErr } = await client.database.from('posts').insert(postRows);
    if (insertErr) return errorResponse('Could not save series parts.', 500, insertErr);

    // Keep total_parts + status in sync; store a light source digest for display.
    await client.database
      .from('series')
      .update({ total_parts: numParts, status: 'draft' })
      .eq('id', series.id)
      .eq('user_id', user.id);

    return NextResponse.json({ parts });
  } catch (err) {
    if (err instanceof LlmError && err.isQuota) {
      return errorResponse('AI provider quota exhausted.', 503, err);
    }
    return errorResponse('Could not plan series.', 500, err);
  }
}
