import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import {
  assertAgentScope,
  getWorkspaceHint,
  resolveAgentAuth,
  resolveAgentWorkspaceId,
} from '@/lib/agent-auth/context';
import { generateWithVoicePipeline } from '@/lib/voice-pipeline';
import { loadCreatorVoiceContext } from '@/lib/voice-context';
import { guardAiRequest } from '@/lib/ai-guard';
import { errorResponse } from '@/lib/api-errors';
import { LlmError } from '@/lib/llm';
import { formatSignalTopicsBlock, getSignalTopicsForGeneration } from '@/lib/signals/content-bridge';
import { trackEvent } from '@/lib/analytics';
import { z } from 'zod';

const RequestSchema = z.object({
  prompt: z.string().min(1).max(10000),
  systemOverride: z.string().max(5000).optional(),
  topic: z.string().max(500).optional(),
  platform: z.enum(['twitter', 'linkedin', 'instagram', 'threads']).optional(),
  contentType: z.enum(['post', 'reply', 'comment', 'hooks', 'caption']).optional(),
  fast: z.boolean().optional(),
  useVoice: z.boolean().optional(),
});

/**
 * POST /api/agent/v1/generate — AI content generation in the creator's voice.
 */
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

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const guard = await guardAiRequest(auth.userId);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const client = getServiceClient();
  const workspaceId = await resolveAgentWorkspaceId(auth.userId, getWorkspaceHint(request));

  const useVoice = parsed.data.useVoice !== false;
  let signalBlock = '';
  if (workspaceId) {
    const topics = await getSignalTopicsForGeneration(client, workspaceId);
    signalBlock = formatSignalTopicsBlock(topics);
  }

  const { profile, contextAdditions } = useVoice
    ? await loadCreatorVoiceContext(client, auth.userId, {
        memoryQuery: parsed.data.topic ?? parsed.data.prompt.slice(0, 200),
        workspaceId: workspaceId ?? undefined,
        platform: parsed.data.platform,
      })
    : { profile: null, contextAdditions: '' };

  const mergedContext = [contextAdditions, signalBlock].filter(Boolean).join('\n') || undefined;

  try {
    const result = await generateWithVoicePipeline({
      userPrompt: parsed.data.prompt,
      profile,
      contextAdditions: mergedContext,
      systemOverride: parsed.data.systemOverride,
      platform: parsed.data.platform,
      contentType: parsed.data.contentType,
      fast: parsed.data.fast,
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
      evaluation: result.evaluation,
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
