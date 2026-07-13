import { NextRequest } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { loadCreatorVoiceContext } from '@/lib/voice-context';
import { z } from 'zod';
import { guardAiRequest } from '@/lib/ai-guard';
import { LlmError } from '@/lib/llm';
import { streamCreatorDraft } from '@/lib/content-pipeline/stream';
import { humanizePipeline, heuristicAiScore } from '@/lib/humanizer';
import { formatSignalTopicsBlock, getSignalTopicsForGeneration } from '@/lib/signals/content-bridge';
import { trackEvent } from '@/lib/analytics';

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

  let signalBlock = '';
  if (workspaceId) {
    const topics = await getSignalTopicsForGeneration(client, workspaceId);
    signalBlock = formatSignalTopicsBlock(topics);
  }

  const voiceContext = useVoice
    ? await loadCreatorVoiceContext(client, user.id, {
        memoryQuery: parsed.data.topic ?? parsed.data.prompt.slice(0, 200),
        workspaceId: workspaceId ?? undefined,
        platform: parsed.data.platform,
      })
    : null;
  const profile = voiceContext?.profile ?? null;
  const contextAdditions = voiceContext?.contextAdditions ?? '';
  // Anti-slop pass preserves the creator's own vocabulary/signature phrases.
  const vocabulary = voiceContext?.vocabulary;
  const completeness = voiceContext?.completeness;
  const autoHumanize = parsed.data.humanize !== false;

  const mergedContext = [contextAdditions, signalBlock].filter(Boolean).join('\n') || undefined;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => {
        try {
          controller.enqueue(encoder.encode(sse(payload)));
        } catch {
          // Client disconnected — nothing to flush to.
        }
      };

      send({ type: 'stage', stage: mode === 'revise' ? 'revising' : 'thinking' });

      try {
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
        // "polishing" stage — voice is already applied in the streamed system
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
            // Never fail the whole generation on a polish hiccup — keep the draft.
            console.error('[generate/stream] auto-humanize failed (non-fatal):', humanizeErr);
          }
        }

        // Free, synchronous slop estimate so the UI can show an AI score without
        // an extra network/quota hit. Lower is better (fewer AI tells).
        const aiSlop = heuristicAiScore(finalText);

        send({
          type: 'done',
          text: finalText,
          used_hook_ids: result.usedHookIds,
          ai_score: aiSlop,
          humanized,
          starved: completeness?.starved ?? false,
          voice_source: completeness?.voiceSource,
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
