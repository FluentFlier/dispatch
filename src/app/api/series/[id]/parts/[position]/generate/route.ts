import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { errorResponse } from '@/lib/api-errors';
import { guardAiRequest } from '@/lib/ai-guard';
import { LlmError } from '@/lib/llm';
import { loadSeries } from '@/lib/series/db';
import { generateSeriesPart } from '@/lib/series/generate-part';
import type { SeriesArcPart } from '@/lib/series/types';

export const maxDuration = 300;

/** Recovers core_point + bridge stashed in the post's notes by the plan step. */
function parseNotes(notes: string | null): { core_point: string; bridge: string } {
  const core = notes?.match(/Core:\s*(.+)/)?.[1]?.trim() ?? '';
  const bridge = notes?.match(/Bridge:\s*(.+)/)?.[1]?.trim() ?? '';
  return { core_point: core, bridge };
}

/**
 * Writes the full draft for one part through the grounded content pipeline and
 * saves it to the part's post. Regenerating resets series_approved to false so a
 * freshly rewritten part must be re-approved before it can auto-publish.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string; position: string } },
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const position = Number(params.position);
  if (!Number.isInteger(position) || position < 1) {
    return NextResponse.json({ error: 'Invalid part position' }, { status: 400 });
  }

  const guard = await guardAiRequest(user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);
  const series = await loadSeries(client, params.id, user.id, workspaceId);
  if (!series) return NextResponse.json({ error: 'Series not found' }, { status: 404 });

  const { data: postRow } = await client.database
    .from('posts')
    .select('id, title, hook, notes')
    .eq('series_id', series.id)
    .eq('series_position', position)
    .eq('user_id', user.id)
    .single();
  if (!postRow) return NextResponse.json({ error: 'Part not found. Plan the arc first.' }, { status: 404 });

  const post = postRow as { id: string; title: string; hook: string | null; notes: string | null };
  const { core_point, bridge } = parseNotes(post.notes);
  const part: SeriesArcPart = {
    position,
    title: post.title,
    hook: post.hook ?? '',
    core_point,
    bridge,
  };

  try {
    const result = await generateSeriesPart({ client, userId: user.id, workspaceId, series, part });

    const { error: updateErr } = await client.database
      .from('posts')
      .update({
        script: result.text,
        status: 'scripted',
        voice_match_score: result.voice_match_score ?? null,
        ai_score: result.ai_score ?? null,
        series_approved: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', post.id)
      .eq('user_id', user.id);
    if (updateErr) return errorResponse('Could not save draft.', 500, updateErr);

    return NextResponse.json({
      postId: post.id,
      text: result.text,
      voice_match_score: result.voice_match_score,
      ai_score: result.ai_score,
    });
  } catch (err) {
    if (err instanceof LlmError && err.isQuota) {
      return errorResponse('AI provider quota exhausted.', 503, err);
    }
    return errorResponse('Generation failed.', 500, err);
  }
}
