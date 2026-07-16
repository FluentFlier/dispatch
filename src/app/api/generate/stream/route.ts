import { NextRequest } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { loadCreatorVoiceContext } from '@/lib/voice-context';
import { getBrainGuidanceForGeneration } from '@/lib/brain/generation-guidance';
import { classifyPromptForMemory } from '@/lib/memory/classify-prompt';
import { z } from 'zod';
import { guardAiRequest } from '@/lib/ai-guard';
import { LlmError } from '@/lib/llm';
import { streamCreatorDraft } from '@/lib/content-pipeline/stream';
import { runContentPipeline, type PipelineStage } from '@/lib/content-pipeline';
import { humanizePipeline, heuristicAiScore } from '@/lib/humanizer';
import { evaluateDraft } from '@/lib/voice-evaluator';
import { formatSignalTopicsBlock, getSignalTopicsForGeneration } from '@/lib/signals/content-bridge';
import { trackEvent } from '@/lib/analytics';
import {
  saveGenerationContext,
  loadGenerationContext,
  recordRegen,
  REGEN_LIGHT_LIMIT,
} from '@/lib/generation-context';

// Single streamed LLM pass, but keep the heavy-route headroom so a slow provider
// start doesn't get cut off mid-stream.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const RequestSchema = z.object({
  prompt: z.string().min(1).max(10000),
  topic: z.string().max(500).optional(),
  platform: z.enum(['twitter', 'linkedin', 'instagram', 'threads']).optional(),
  mode: z.enum(['draft', 'revise']).optional(),
  useVoice: z.boolean().optional(),
  /** Auto-humanize the streamed draft (anti-slop clean + audit). Defaults on. */
  humanize: z.boolean().optional(),
  mentions: z.array(z.string().max(100)).max(10).optional(),
  /**
   * Bundle id from a prior draft's `done` event. On a revise, lets the server
   * reuse the cached context (fast light regen) and track regen_count so the
   * >N-th regen reloads the full pipeline.
   */
  context_id: z.string().uuid().optional(),
});

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export async function POST(request: NextRequest): Promise<Response> {
  const user = await getAuthenticatedUser();
  if (!user) return jsonError('Unauthorized', 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON', 400);
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) return jsonError(parsed.error.message, 400);

  const guard = await guardAiRequest(user.id);
  if (!guard.ok) return jsonError(guard.error ?? 'Rate limited', guard.status);

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);
  const useVoice = parsed.data.useVoice !== false;
  const mode = parsed.data.mode ?? 'draft';

  // Regen fast path: a revise carrying a bundle id reuses the context assembled
  // on the first draft, skipping the expensive brain/Supermemory/story-bank reads.
  const cached =
    mode === 'revise' && parsed.data.context_id
      ? await loadGenerationContext(client, parsed.data.context_id, user.id)
      : null;
  // Once the light-regen budget is spent, reload the full pipeline (and reset).
  const doFullReload = Boolean(cached && cached.regenCount >= REGEN_LIGHT_LIMIT);

  let signalBlock = '';
  if (!cached && workspaceId) {
    const topics = await getSignalTopicsForGeneration(client, workspaceId);
    signalBlock = formatSignalTopicsBlock(topics);
  }

  // Close the loop: feed what the brain has learned about this creator's own
  // top posts (strongest pillar, winning hook style) back into the draft.
  let brainBlock = '';
  if (!cached && useVoice) {
    brainBlock = await getBrainGuidanceForGeneration(client, user.id, workspaceId ?? undefined);
  }

  // Steer memory retrieval the same way the non-stream /api/generate route does.
  // Without classification the composer searched memory with the raw prompt prefix
  // and only the top 3 docs, so a "remember the people I met at <event>" prompt
  // failed to surface the specific past post and the model invented/dropped real
  // names. Classify → entity-rich query + limit 10 for a specific event. Skipped
  // on the cached regen fast-path. Never throws (degrades to the naive query).
  const memoryPlan =
    !cached && useVoice
      ? await classifyPromptForMemory(parsed.data.prompt)
      : { topics: [] as string[], time_scope: 'any' as const, search_query: '' };
  const memoryLimit = memoryPlan.time_scope === 'specific' ? 10 : 3;

  const voiceContext =
    !cached && useVoice
      ? await loadCreatorVoiceContext(client, user.id, {
          memoryQuery: memoryPlan.search_query || parsed.data.topic || parsed.data.prompt.slice(0, 200),
          memoryLimit,
          workspaceId: workspaceId ?? undefined,
          platform: parsed.data.platform,
        })
      : null;
  const profile = cached ? cached.profile : voiceContext?.profile ?? null;
  const contextAdditions = cached ? cached.contextAdditions ?? '' : voiceContext?.contextAdditions ?? '';
  // Anti-slop pass preserves the creator's own vocabulary/signature phrases.
  const vocabulary = cached ? cached.vocabulary : voiceContext?.vocabulary;
  const structural = cached ? cached.structural : voiceContext?.structural;
  const completeness = voiceContext?.completeness;
  const autoHumanize = parsed.data.humanize !== false;

  const mergedContext = [contextAdditions, signalBlock, brainBlock].filter(Boolean).join('\n') || undefined;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => {
        try {
          controller.enqueue(encoder.encode(sse(payload)));
        } catch {
          // Client disconnected - nothing to flush to.
        }
      };

      send({ type: 'stage', stage: mode === 'revise' ? 'revising' : 'thinking' });

      try {
        // Full staged pipeline (base -> hooks -> humanize -> voice ->
        // evaluate/revise -> escalate) for maximum quality. Runs for the first
        // draft AND when a thread has exhausted its light-regen budget. It does
        // not stream tokens, so we surface staged progress instead. Other revises
        // use the fast single-call streaming path below.
        if (mode === 'draft' || doFullReload) {
          const STAGE_UI: Record<PipelineStage, 'thinking' | 'writing' | 'polishing' | 'scoring'> = {
            research: 'thinking', base: 'writing', hooks: 'writing',
            humanize: 'polishing', voice: 'writing', evaluate: 'scoring',
          };
          const result = await runContentPipeline({
            userPrompt: parsed.data.prompt,
            profile,
            contextAdditions: mergedContext,
            platform: parsed.data.platform,
            contentType: 'post',
            useVoice,
            mentions: parsed.data.mentions,
            hooksClient: client,
            vocabulary,
            structural,
            userId: user.id,
            onStage: (stage) => send({ type: 'stage', stage: STAGE_UI[stage] ?? 'writing' }),
          });

          // Persist/refresh the context bundle so subsequent revises regen fast.
          // A full reload resets the light-regen counter to 0; a first draft
          // creates a new bundle.
          let contextId: string | null = null;
          if (doFullReload && cached) {
            await recordRegen(client, cached.id, result.text, 0);
            contextId = cached.id;
          } else {
            contextId = await saveGenerationContext(client, {
              userId: user.id,
              workspaceId,
              userPrompt: parsed.data.prompt,
              contextAdditions: mergedContext,
              profile,
              vocabulary,
              structural,
              mentions: parsed.data.mentions,
              platform: parsed.data.platform,
              contentType: 'post',
              lastDraft: result.text,
            });
          }

          send({
            type: 'done',
            text: result.text,
            used_hook_ids: result.usedHookIds ?? [],
            ai_score: result.ai_score,
            voice_match_score: result.voice_match_score,
            humanized: true,
            starved: completeness?.starved ?? false,
            voice_source: completeness?.voiceSource,
            context_id: contextId,
          });

          void trackEvent('generation_complete', {
            platform: parsed.data.platform ?? 'unknown',
            hooks_used: result.usedHookIds?.length ?? 0,
            mode,
            streamed: false,
            humanized: true,
          });
          return;
        }

        let started = false;
        const result = await streamCreatorDraft(
          {
            userPrompt: parsed.data.prompt,
            profile,
            contextAdditions: mergedContext,
            platform: parsed.data.platform,
            useVoice,
            mode,
            mentions: parsed.data.mentions,
            hooksClient: client,
          },
          (delta: string) => {
            if (!started) {
              started = true;
              send({ type: 'stage', stage: 'writing' });
            }
            send({ type: 'token', delta });
          },
        );

        // Auto-humanize: the streamed draft is one fast LLM pass, so it still
        // carries AI tells. Run the anti-slop pipeline (clean + audit) as a
        // "polishing" stage - voice is already applied in the streamed system
        // prompt, so skipVoice avoids a redundant rewrite. This is what makes
        // the default Write flow ship human-sounding drafts without a manual
        // Polish tap.
        let finalText = result.text;
        let humanized = false;
        if (autoHumanize) {
          try {
            send({ type: 'stage', stage: 'polishing' });
            const polished = await humanizePipeline(result.text, {
              profile: null,
              skipVoice: true,
              skipAudit: false,
              vocabulary,
            });
            finalText = polished.text;
            humanized = true;
          } catch (humanizeErr) {
            // Never fail the whole generation on a polish hiccup - keep the draft.
            console.error('[generate/stream] auto-humanize failed (non-fatal):', humanizeErr);
          }
        }

        // Free, synchronous slop estimate so the UI can show an AI score without
        // an extra network/quota hit. Lower is better (fewer AI tells).
        const aiSlop = heuristicAiScore(finalText);

        // Real voice-match score (persona_fidelity from the judge model), not a
        // guess: without this, downstream scoring (/api/posts/predict) always
        // fell back to a fixed 60 default for the streamed path, capping every
        // predicted score in the low-80s regardless of actual draft quality.
        // evaluateDraft never throws (it returns a neutral skip result on
        // failure), so no try/catch needed here.
        let voiceMatchScore: number | null = null;
        if (useVoice) {
          send({ type: 'stage', stage: 'scoring' });
          const evalResult = await evaluateDraft(finalText, profile, contextAdditions || undefined, 'post');
          if (!evalResult.parse_error) {
            voiceMatchScore = Math.round((evalResult.persona_fidelity / 10) * 100);
          }
        }

        // Light-path regen: bump the cached bundle's counter so the pipeline
        // reloads once the budget is spent. context_id is echoed back so the UI
        // keeps threading it through subsequent revises.
        if (cached) {
          await recordRegen(client, cached.id, finalText, cached.regenCount + 1);
        }

        send({
          type: 'done',
          text: finalText,
          used_hook_ids: result.usedHookIds,
          ai_score: aiSlop,
          voice_match_score: voiceMatchScore,
          humanized,
          starved: completeness?.starved ?? false,
          voice_source: completeness?.voiceSource,
          context_id: cached?.id ?? null,
        });

        void trackEvent('generation_complete', {
          platform: parsed.data.platform ?? 'unknown',
          hooks_used: result.usedHookIds.length,
          mode,
          streamed: true,
          humanized,
        });
      } catch (err) {
        const message =
          err instanceof LlmError && err.isQuota
            ? 'AI provider quota exhausted. Top up credits or switch LLM_* provider env.'
            : 'Generation failed.';
        console.error('[generate/stream] failed:', err);
        send({ type: 'error', error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
