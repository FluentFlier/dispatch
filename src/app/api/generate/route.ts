import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { generateWithVoicePipeline } from '@/lib/voice-pipeline';
import { loadCreatorVoiceContext } from '@/lib/voice-context';
import { generateContent } from '@/lib/ai';
import { buildPlatformOptimizationPrompt, type OptimizePlatform } from '@/lib/platform-optimize';
import { z } from 'zod';
import { guardAiRequest } from '@/lib/ai-guard';
import { errorResponse } from '@/lib/api-errors';
import { LlmError } from '@/lib/llm';

/** Content types that are full prose posts (eligible for the human polish pass). */
const POLISHABLE_TYPES = new Set(['post', undefined]);

/** Strip em dashes to match the plain-text house style. */
function stripEmDashes(text: string): string {
  return text.replace(/—/g, ' - ').replace(/–/g, '-');
}

const RequestSchema = z.object({
  prompt: z.string().min(1).max(10000),
  systemOverride: z.string().max(5000).optional(),
  /** Optional topic for semantic memory retrieval (Supermemory) */
  topic: z.string().max(500).optional(),
  platform: z.enum(['twitter', 'linkedin', 'instagram', 'threads']).optional(),
  contentType: z.enum(['post', 'reply', 'comment', 'hooks', 'caption']).optional(),
  /** Skip voice critique/revise (faster) */
  fast: z.boolean().optional(),
  /** When false, generate without importing the creator's voice (default true). */
  useVoice: z.boolean().optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Parse body before the guard so we can return a 400 before consuming quota.
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const guard = await guardAiRequest(user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);

  // When the user opts out of voice, skip loading their profile + semantic
  // memory entirely so nothing personal reaches the prompt.
  const useVoice = parsed.data.useVoice !== false;
  const { profile, contextAdditions } = useVoice
    ? await loadCreatorVoiceContext(client, user.id, {
        memoryQuery: parsed.data.topic ?? parsed.data.prompt.slice(0, 200),
        workspaceId: workspaceId ?? undefined,
      })
    : { profile: null, contextAdditions: '' };

  try {
    const result = await generateWithVoicePipeline({
      userPrompt: parsed.data.prompt,
      profile,
      contextAdditions: contextAdditions || undefined,
      systemOverride: parsed.data.systemOverride,
      platform: parsed.data.platform,
      contentType: parsed.data.contentType,
      fast: parsed.data.fast ?? false,
      useVoice,
    });

    // Integrated human-polish pass: the platform-optimization step users liked
    // from the repurpose panel is now folded into the main generate, so a single
    // output has both the voice pipeline's features AND the humaner platform
    // tone. Runs only for full prose posts (skips fast mode + hooks/caption/reply).
    let finalText = result.text;
    if (
      parsed.data.platform &&
      !parsed.data.fast &&
      POLISHABLE_TYPES.has(parsed.data.contentType) &&
      result.text.trim().length > 0
    ) {
      try {
        const polishPrompt = buildPlatformOptimizationPrompt(
          parsed.data.platform as OptimizePlatform,
          result.text,
          'full',
        );
        // Run the polish on a smaller/cheaper model (default llama-3.1-8b-instant)
        // while the main draft stays on the primary model — cuts token cost of
        // the extra pass. Configurable via LLM_POLISH_MODEL.
        const polishModel = process.env.LLM_POLISH_MODEL || 'llama-3.1-8b-instant';
        const polished = await generateContent(polishPrompt, contextAdditions || undefined, undefined, profile, polishModel);
        if (polished.trim().length > 0) finalText = stripEmDashes(polished);
      } catch {
        // Polish is a best-effort enhancement; fall back to the voice draft.
      }
    }

    return NextResponse.json({
      text: finalText,
      voice_match_score: result.voice_match_score,
      ai_score: result.ai_score,
      revised: result.revised,
      flags: result.flags,
      iterations: result.iterations,
      evaluation: result.evaluation,
    });
  } catch (err) {
    // Surface provider quota/rate-limit as a clear, actionable status instead of
    // an opaque 500, so clients and monitoring can distinguish "out of credits"
    // from a genuine code fault.
    if (err instanceof LlmError && err.isQuota) {
      return errorResponse(
        'AI provider quota exhausted. Top up credits or switch LLM_* provider env.',
        503,
        err,
      );
    }
    return errorResponse('Generation failed.', 500, err);
  }
}
