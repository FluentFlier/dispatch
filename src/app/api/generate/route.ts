import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { generateWithVoicePipeline } from '@/lib/voice-pipeline';
import { loadCreatorVoiceContext } from '@/lib/voice-context';
import { z } from 'zod';
import { checkRateLimit } from '@/lib/rate-limit';

const RequestSchema = z.object({
  prompt: z.string().min(1).max(10000),
  systemOverride: z.string().max(5000).optional(),
  /** Optional topic for semantic memory retrieval (Supermemory) */
  topic: z.string().max(500).optional(),
  platform: z.enum(['twitter', 'linkedin', 'instagram', 'threads']).optional(),
  contentType: z.enum(['post', 'reply', 'comment']).optional(),
  /** Skip voice critique/revise (faster) */
  fast: z.boolean().optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Monetization + usage tracking for intelligence layer
  const { usage } = await import('@/lib/hooks-intelligence/usage-tracker');
  await usage.track(user.id, 'generate');

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const rl = await checkRateLimit(user.id);
  if (!rl.allowed) {
    const retryAfter = Math.ceil((rl.resetAt - Date.now()) / 1000);
    return NextResponse.json(
      { error: 'Rate limit exceeded. Try again later.' },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfter) },
      },
    );
  }

  const client = getServerClient();
  const { profile, contextAdditions } = await loadCreatorVoiceContext(client, user.id, {
    memoryQuery: parsed.data.topic ?? parsed.data.prompt.slice(0, 200),
  });

  try {
    const result = await generateWithVoicePipeline({
      userPrompt: parsed.data.prompt,
      profile,
      contextAdditions: contextAdditions || undefined,
      systemOverride: parsed.data.systemOverride,
      platform: parsed.data.platform,
      contentType: parsed.data.contentType,
      fast: parsed.data.fast ?? false,
    });

    return NextResponse.json({
      text: result.text,
      voice_match_score: result.voice_match_score,
      ai_score: result.ai_score,
      revised: result.revised,
      flags: result.flags,
      iterations: result.iterations,
      evaluation: result.evaluation,
    });
  } catch (err) {
    console.error('Claude API error:', err);
    return NextResponse.json({ error: 'Generation failed' }, { status: 500 });
  }
}
