import { buildSystemPrompt, type CreatorProfileForPrompt } from '@/lib/ai';
import { generateContentHF } from '@/lib/huggingface';
import { humanize } from '@/lib/humanizer';
import { evaluateDraft, evaluationPasses, type VoiceEvaluationMatrix } from '@/lib/voice-evaluator';
import { buildVoiceComposeHints } from '@/lib/voice-prompts';
import { getBestHooksForContext } from '@/lib/hooks-intelligence';

export interface VoicePipelineInput {
  userPrompt: string;
  profile: CreatorProfileForPrompt | null;
  contextAdditions?: string;
  systemOverride?: string;
  platform?: string;
  contentType?: 'post' | 'reply' | 'comment';
  /** Skip critique/revise pass (faster, cheaper) */
  fast?: boolean;
  /** Max draft→evaluate→revise loops (Imagine uses until all metrics pass) */
  maxIterations?: number;
}

export interface VoicePipelineResult {
  text: string;
  voice_match_score: number;
  ai_score: number;
  revised: boolean;
  flags: string[];
  evaluation?: VoiceEvaluationMatrix;
  iterations: number;
  /** IDs of hooks injected into the generation prompt, stored on the post for nightly RL scoring. */
  usedHookIds?: string[];
}

function stripEmDashes(text: string): string {
  return text.replace(/—/g, ' - ').replace(/–/g, '-');
}

/**
 * End-to-end voice generation: draft → score → optional revise → humanize.
 * Mirrors multi-step agent graphs (Imagine/LangGraph) without hosted graph infra.
 */
export async function generateWithVoicePipeline(
  input: VoicePipelineInput,
): Promise<VoicePipelineResult> {
  const contentType = input.contentType ?? 'post';
  const composeHints = buildVoiceComposeHints(input.platform, contentType);

  // Usage is tracked at the API boundary (/api/generate) so it is counted once
  // per request; the pipeline stays a pure content function.
  const taskHint = input.platform
    ? `Platform: ${input.platform}. Match native format and length.`
    : undefined;

  // === PHENOMENAL HOOK INTELLIGENCE INJECTION ===
  // Pull real, ranked, high-conversion hooks mined via gstack from the best creators.
  // This is how we make posts *actually* amazing instead of generic.
  const topHooks = getBestHooksForContext(undefined as any, 6); // can be made vertical-aware later
  const usedHookIds = topHooks.map(h => h.id);
  const hookExamples = topHooks.length > 0
    ? `\n\nREAL HIGH-CONVERTING HOOK EXAMPLES (use these structures + adapt to voice):\n${topHooks.map((h, i) => `${i+1}. "${h.text}" (@${h.author})`).join('\n')}`
    : '';

  const mergedContext = [composeHints, taskHint, input.contextAdditions, hookExamples]
    .filter(Boolean)
    .join('\n\n');

  const systemPrompt = input.systemOverride
    ? `${input.systemOverride}\n\n${composeHints}`
    : buildSystemPrompt(input.profile, mergedContext || undefined);

  const maxIterations = input.maxIterations ?? 2;
  let text = '';
  let revised = false;
  let evaluation: VoiceEvaluationMatrix | undefined;
  let iterations = 0;

  for (let i = 0; i < maxIterations; i++) {
    iterations = i + 1;
    const draftPrompt =
      i === 0
        ? input.userPrompt
        : `Rewrite from scratch. Previous draft failed voice QA.

ORIGINAL REQUEST:
${input.userPrompt}

REVISION NOTES:
${evaluation?.revision_notes ?? 'Sound more like the creator. Less generic.'}

Return ONLY the new text.`;

    text = stripEmDashes(
      await generateContentHF(systemPrompt, draftPrompt),
    );

    if (input.fast) break;

    evaluation = await evaluateDraft(
      text,
      input.profile,
      mergedContext || undefined,
      contentType,
    );

    if (evaluationPasses(evaluation)) break;
    revised = i > 0;
  }

  if (!input.fast && evaluation && evaluation.ai_slop > 3) {
    try {
      text = stripEmDashes(await humanize(text, input.profile));
    } catch {
      // keep draft
    }
  }

  const voice_match_score = evaluation
    ? Math.round((evaluation.persona_fidelity / 10) * 100)
    : 0;
  const ai_score = evaluation ? evaluation.ai_slop * 10 : 0;
  const flags: string[] = evaluation && !evaluation.pass
    ? ['below_voice_threshold']
    : [];

  return {
    text,
    voice_match_score,
    ai_score,
    revised,
    flags,
    evaluation,
    iterations,
    usedHookIds: usedHookIds.length > 0 ? usedHookIds : undefined,
  };
}
