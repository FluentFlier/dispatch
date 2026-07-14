import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { humanizePipeline, aiScore } from '@/lib/humanizer';
import { loadCreatorVoiceContext } from '@/lib/voice-context';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { z } from 'zod';
import { guardAiRequest } from '@/lib/ai-guard';
import { errorResponse } from '@/lib/api-errors';

const HumanizeSchema = z.object({
  text: z.string().min(1).max(25000),
  scoreOnly: z.boolean().optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = HumanizeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  // scoreOnly uses HF classifier (free, no quota) - skip guard entirely
  if (parsed.data.scoreOnly) {
    try {
      const result = await aiScore(parsed.data.text);
      return NextResponse.json(result);
    } catch (err) {
      return errorResponse('Scoring failed.', 500, err);
    }
  }

  const guard = await guardAiRequest(user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);
  const { profile, contextAdditions, vocabulary } = await loadCreatorVoiceContext(client, user.id, {
    workspaceId: workspaceId ?? undefined,
  });

  try {
    const result = await humanizePipeline(parsed.data.text, {
      profile,
      contextAdditions: contextAdditions || undefined,
      vocabulary,
    });
    return NextResponse.json({
      text: result.text,
      passes: result.passes,
    });
  } catch (err) {
    return errorResponse('Humanization failed.', 500, err);
  }
}
