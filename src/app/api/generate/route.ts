import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { generateWithVoicePipeline } from '@/lib/voice-pipeline';
import { loadCreatorVoiceContext } from '@/lib/voice-context';
import { z } from 'zod';
import { guardAiRequest } from '@/lib/ai-guard';
import { errorResponse } from '@/lib/api-errors';
import { LlmError } from '@/lib/llm';
import { formatSignalTopicsBlock, getSignalTopicsForGeneration } from '@/lib/signals/content-bridge';
import { trackEvent } from '@/lib/analytics';
import { classifyPromptForMemory } from '@/lib/memory/classify-prompt';

// The voice pipeline runs several sequential LLM calls (base → hooks → humanize →
// voice → evaluate) and can exceed the platform default function timeout, which
// surfaces to the client as a failed generation. Give it the same headroom as the
// other heavy AI routes (signals/onboarding) so prod doesn't cut it off.
export const maxDuration = 300;

const RequestSchema = z.object({
  prompt: z.string().min(1).max(10000),
  systemOverride: z.string().max(5000).optional(),
  topic: z.string().max(500).optional(),
  platform: z.enum(['twitter', 'linkedin', 'instagram', 'threads']).optional(),
  contentType: z.enum(['post', 'thread', 'reply', 'comment', 'hooks', 'caption']).optional(),
  fast: z.boolean().optional(),
  useVoice: z.boolean().optional(),
  mentions: z.array(z.string().max(100)).max(10).optional(),
  research: z.boolean().optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const guard = await guardAiRequest(user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);

  const useVoice = parsed.data.useVoice !== false;
  let signalBlock = '';
  if (workspaceId) {
    const topics = await getSignalTopicsForGeneration(client, workspaceId);
    signalBlock = formatSignalTopicsBlock(topics);
  }

  // Classify the prompt to steer memory retrieval: entity-rich query + how hard
  // to search. Runs on the cheap `fast` tier and never throws (degrades to the
  // naive whole-prompt query). Only when useVoice — with voice off there is no
  // memory retrieval, so classifying would be a wasted LLM call.
  const memoryPlan = useVoice
    ? await classifyPromptForMemory(parsed.data.prompt)
    : { topics: [] as string[], time_scope: 'any' as const, search_query: '' };
  const memoryLimit = memoryPlan.time_scope === 'specific' ? 10 : 3;

  const { profile, contextAdditions, completeness, vocabulary, structural } = useVoice
    ? await loadCreatorVoiceContext(client, user.id, {
        memoryQuery: memoryPlan.search_query || parsed.data.topic || parsed.data.prompt.slice(0, 200),
        memoryLimit,
        workspaceId: workspaceId ?? undefined,
        platform: parsed.data.platform,
      })
    : { profile: null, contextAdditions: '', completeness: undefined, vocabulary: undefined, structural: undefined };

  const mergedContext = [contextAdditions, signalBlock].filter(Boolean).join('\n') || undefined;

  try {
    const result = await generateWithVoicePipeline({
      userPrompt: parsed.data.prompt,
      profile,
      contextAdditions: mergedContext,
      systemOverride: parsed.data.systemOverride,
      platform: parsed.data.platform,
      contentType: parsed.data.contentType,
      fast: parsed.data.fast ?? false,
      useVoice,
      mentions: parsed.data.mentions,
      hooksClient: client,
      vocabulary,
      structural,
      research: parsed.data.research,
    });

    void trackEvent('generation_complete', {
      platform: parsed.data.platform ?? 'unknown',
      hooks_used: result.usedHookIds?.length ?? 0,
      voice_score: result.voice_match_score,
    });

    return NextResponse.json({
      text: result.text,
      voice_match_score: result.voice_match_score,
      ai_score: result.ai_score,
      revised: result.revised,
      flags: result.flags,
      iterations: result.iterations,
      evaluation: result.evaluation,
      used_hook_ids: result.usedHookIds ?? [],
      hook_explanations: result.hookExplanations ?? [],
      pipeline_stages: result.stagesCompleted ?? [],
      humanize_passes: result.humanizePasses ?? [],
      // Context completeness so the UI/agent can flag a starved prompt (e.g. Voice
      // Lab not run) instead of the thinning being invisible.
      context_completeness: completeness ?? null,
    });
  } catch (err) {
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
