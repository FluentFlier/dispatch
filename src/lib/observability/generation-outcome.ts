/**
 * Post-generation outcome recording (spec 4.2 + 4.3 dashboard feed).
 * Observation ONLY: re-runs the free deterministic checks on the final text
 * and records what shipped; it never modifies or blocks the generation.
 *
 * Two sinks:
 *  1. Langfuse trace attributes (when keys present).
 *  2. pipeline_events row event='generation_complete', written via the same
 *     emitPipelineEvent() the Phase 3 degradation events use - reuses its
 *     lazy-import, throw-safe, EVALS_MODE-gated insert instead of a second
 *     copy of that logic. This row is the DENOMINATOR for every dashboard
 *     share metric (every OTHER event is a numerator over it) and carries
 *     per-check + slop hit data for the monthly leak audit.
 *
 * NEVER throws: callers invoke fire-and-forget.
 */
import { runChecks, type CheckContext } from '@/lib/content-pipeline/checks';
import { emitPipelineEvent } from '@/lib/content-pipeline/events';
import { PROMPT_VERSION, type ContentPipelineInput, type ContentPipelineResult, type PipelineStage } from '@/lib/content-pipeline';
import { updateSpanAttrs } from './langfuse';

export interface OutcomeDetail {
  promptVersion: string;
  mode: 'full' | 'compact_or_partial';
  iterations: number;
  revised: boolean;
  flags: string[];
  voiceMatchScore: number;
  aiScore: number;
  hardCheckFailures: string[];
  softCheckFailures: string[];
  slopEvidence: string[]; // monthly leak audit reads this (lexicon hit-rates)
  chars: number;
  platform?: string;
  contentType: string;
}

const FULL_STAGES: PipelineStage[] = ['base', 'hooks', 'humanize', 'voice', 'evaluate'];

// index.ts imports recordGenerationOutcome from this module, so this is a
// runtime import cycle. It is safe: PROMPT_VERSION is a const read only at
// call time (inside buildOutcomeDetail), never at module-eval time, so the
// ESM live binding is resolved by the time it is read.

export function buildOutcomeDetail(
  input: ContentPipelineInput,
  result: ContentPipelineResult,
): OutcomeDetail {
  const ctx: CheckContext = {
    contentType: input.contentType ?? 'post',
    platform: input.platform,
    userPrompt: input.userPrompt,
    sourceContext: input.contextAdditions,
    profile: input.profile ? { display_name: input.profile.display_name } : null,
    mentions: input.mentions,
  };
  const results = runChecks(result.text, ctx);
  const failed = results.filter((r) => !r.pass);
  const slop = failed.find((r) => r.id === 'slop_phrases');
  const mode: OutcomeDetail['mode'] = FULL_STAGES.every((s) => result.stagesCompleted.includes(s))
    ? 'full'
    : 'compact_or_partial';

  return {
    promptVersion: PROMPT_VERSION,
    mode,
    iterations: result.iterations,
    revised: result.revised,
    flags: result.flags,
    voiceMatchScore: result.voice_match_score,
    aiScore: result.ai_score,
    hardCheckFailures: failed.filter((r) => r.severity === 'hard').map((r) => r.id),
    softCheckFailures: failed.filter((r) => r.severity === 'soft').map((r) => r.id),
    slopEvidence: slop?.evidence ? [slop.evidence] : [],
    chars: result.text.length,
    platform: input.platform,
    contentType: input.contentType ?? 'post',
  };
}

export async function recordGenerationOutcome(
  requestId: string,
  input: ContentPipelineInput,
  result: ContentPipelineResult,
): Promise<void> {
  try {
    const detail = buildOutcomeDetail(input, result);

    await updateSpanAttrs({
      requestId,
      voice_match_score: detail.voiceMatchScore,
      ai_score: detail.aiScore,
      iterations: detail.iterations,
      mode: detail.mode,
      hard_check_failures: detail.hardCheckFailures.join(',') || 'none',
    });

    await emitPipelineEvent({
      requestId,
      userId: input.userId,
      event: 'generation_complete',
      // OutcomeDetail has no index signature; through unknown is the localized
      // cast (vs weakening the interface globally with [k: string]: unknown).
      detail: detail as unknown as Record<string, unknown>,
    });
  } catch (err) {
    console.warn('[observability] outcome recording failed (generation unaffected)', err);
  }
}
