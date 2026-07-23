import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { loadCreatorVoiceContext } from '@/lib/voice-context';
import { evaluateDraft } from '@/lib/voice-evaluator';
import { guardAiRequest } from '@/lib/ai-guard';
import { z } from 'zod';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

const RequestSchema = z.object({
  text: z.string().min(1).max(25000),
  platform: z.enum(['twitter', 'linkedin', 'instagram', 'threads']).optional(),
});

/**
 * POST /api/write/review: run a manual draft through the voice judge and return
 * the raw evaluation matrix. Used by the Write page's AI review button.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const guard = await guardAiRequest(user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error ?? 'Rate limited' }, { status: guard.status });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);
  const voiceContext = await loadCreatorVoiceContext(client, user.id, {
    memoryQuery: parsed.data.text.slice(0, 200),
    workspaceId: workspaceId ?? undefined,
    platform: parsed.data.platform,
  });

  const evaluation = await evaluateDraft(
    parsed.data.text,
    voiceContext?.profile ?? null,
    voiceContext?.contextAdditions || undefined,
    'post',
  );

  if (evaluation.parse_error) {
    return NextResponse.json({ error: 'Review is unavailable right now. Try again.' }, { status: 502 });
  }

  return NextResponse.json({ evaluation });
}
