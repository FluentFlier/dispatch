import type { createClient } from '@insforge/sdk';
import { buildSystemPrompt, type CreatorProfileForPrompt } from '@/lib/ai';
import { chatCompletion } from '@/lib/llm';
import { humanizePipeline } from '@/lib/humanizer';
import { evaluateDraft, evaluationPasses, type VoiceEvaluationMatrix } from '@/lib/voice-evaluator';
import { buildVoiceComposeHints, type VoiceContentType } from '@/lib/voice-prompts';
import { getBestHooksForGeneration } from '@/lib/hooks-intelligence/resolve-hooks';
import { PILLAR_TO_VERTICAL, type HookVertical } from '@/lib/hooks-intelligence/types';
import { profilePillarWeights } from '@/lib/pillars';
import { substanceContextOnly } from '@/lib/content-pipeline/context-split';

type InsforgeClient = ReturnType<typeof createClient>;

export type PipelineStage =
  | 'base'
  | 'hooks'
  | 'humanize'
  | 'voice'
  | 'evaluate';

export interface ContentPipelineInput {
  userPrompt: string;
  profile: CreatorProfileForPrompt | null;
  contextAdditions?: string;
  systemOverride?: string;
  platform?: string;
  contentType?: VoiceContentType;
  fast?: boolean;
  useVoice?: boolean;
  skipHooks?: boolean;
  humanizeAlways?: boolean;
  maxIterations?: number;
  /** Optional InsForge client for DB-learned hook retrieval. */
  hooksClient?: InsforgeClient;
}

export interface ContentPipelineResult {
  text: string;
  voice_match_score: number;
  ai_score: number;
  revised: boolean;
  flags: string[];
  evaluation?: VoiceEvaluationMatrix;
  iterations: number;
  usedHookIds?: string[];
  stagesCompleted: PipelineStage[];
  humanizePasses?: string[];
}

const BASE_SYSTEM = `You are an expert social content strategist writing for real creators.

Your job in this pass: write the SUBSTANCE — clear message, specific details, strong structure.
Do NOT worry about hooks or personal voice yet. Focus on:
- One clear takeaway the reader cares about
- Concrete details (names, numbers, moments) — never vague claims
- Platform-native length and format
- Plain text only — no markdown, no em dashes, no title/headline unless requested

Write like a smart person outlining their post before polishing it.`;

const HOOK_SYSTEM = `You are a hook specialist for social media creators.

Rewrite ONLY the opening and tighten structure using the hook examples provided.
- First 1-2 lines must stop the scroll (adapt hook STRUCTURE, not copy topics)
- Keep all facts and body content from the draft
- Do not add generic AI phrasing
- Plain text only, no em dashes`;

function stripEmDashes(text: string): string {
  return text.replace(/—/g, ' - ').replace(/–/g, '-');
}

function topWeightedVertical(profile: CreatorProfileForPrompt | null): HookVertical | undefined {
  const weights = profilePillarWeights(profile?.content_pillars);
  const entries = Object.entries(weights);
  if (entries.length === 0) return undefined;
  entries.sort((a, b) => b[1] - a[1]);
  return PILLAR_TO_VERTICAL[entries[0][0]];
}

function formatHookExamples(hooks: Array<{ id: string; text: string; author: string }>): string {
  if (hooks.length === 0) return '';
  return hooks
    .map((h, i) => `${i + 1}. "${h.text}" (@${h.author.replace(/^@+/, '')})`)
    .join('\n');
}

/**
 * Stage 1 — Base draft: substance + platform format, minimal voice.
 */
async function runBaseStage(
  input: ContentPipelineInput,
  substanceContext: string | undefined,
): Promise<string> {
  const composeHints = buildVoiceComposeHints(input.platform, input.contentType ?? 'post');
  const taskHint = input.platform
    ? `Platform: ${input.platform}. Match native format and length.`
    : undefined;

  const merged = [composeHints, taskHint, substanceContext].filter(Boolean).join('\n\n');
  const system = input.systemOverride
    ? `${input.systemOverride}\n\n${composeHints}`
    : `${BASE_SYSTEM}\n\n${merged}`;

  return stripEmDashes(await chatCompletion(system, input.userPrompt, { temperature: 0.75 }));
}

/**
 * Stage 2 — Hook layer: apply high-converting openers to the base draft.
 */
async function runHookStage(
  baseText: string,
  hooks: Array<{ id: string; text: string; author: string }>,
  userPrompt: string,
): Promise<string> {
  if (hooks.length === 0) return baseText;

  const examples = formatHookExamples(hooks);
  const prompt = `ORIGINAL REQUEST:\n${userPrompt}\n\nBASE DRAFT:\n---\n${baseText}\n---\n\nHOOK EXAMPLES (adapt structure to this topic):\n${examples}\n\nRewrite with a stronger hook opening. Return ONLY the full post.`;

  return stripEmDashes(await chatCompletion(HOOK_SYSTEM, prompt, { temperature: 0.7 }));
}

/**
 * Four-stage creator pipeline:
 * 1. Base (substance) → 2. Hooks → 3. Humanize (clean + audit) → 4. Voice → evaluate/revise
 *
 * Why this order: mixing voice + anti-slop in one pass averages toward generic.
 * Hooks on substance preserve facts; humanize before voice removes AI tells first;
 * voice last makes it sound like THEM without reintroducing slop.
 */
export async function runContentPipeline(
  input: ContentPipelineInput,
): Promise<ContentPipelineResult> {
  const stagesCompleted: PipelineStage[] = [];
  const useVoice = input.useVoice !== false;
  const profile = useVoice ? input.profile : null;
  const skipEval = input.fast || !useVoice;
  const substanceContext = substanceContextOnly(input.contextAdditions);
  const fullContext = input.contextAdditions;

  // --- Stage 1: Base ---
  let text = await runBaseStage(input, substanceContext);
  stagesCompleted.push('base');

  const contentType = input.contentType ?? 'post';
  const isProse = contentType === 'post' || contentType === 'reply' || contentType === 'comment';

  // Voice-off: substance only (optional humanize for outreach).
  if (!useVoice) {
    if (input.humanizeAlways) {
      const h = await humanizePipeline(text, { skipVoice: true, skipAudit: true });
      text = h.text;
      stagesCompleted.push('humanize');
      return finalizeResult(text, undefined, false, [], stagesCompleted, h.passes, undefined);
    }
    return finalizeResult(text, undefined, true, [], stagesCompleted, undefined, undefined);
  }

  // Fast mode / non-prose: base + light humanize
  if (input.fast || !isProse) {
    if (input.humanizeAlways || !useVoice) {
      const h = await humanizePipeline(text, { skipVoice: true, skipAudit: true });
      text = h.text;
      stagesCompleted.push('humanize');
      return finalizeResult(text, undefined, false, [], stagesCompleted, h.passes, undefined);
    }
    return finalizeResult(text, undefined, skipEval, [], stagesCompleted, undefined, undefined);
  }

  // --- Stage 2: Hooks ---
  let usedHookIds: string[] | undefined;
  if (!input.skipHooks) {
    const vertical = topWeightedVertical(profile);
    const hooks = await getBestHooksForGeneration(input.hooksClient, vertical, 6);
    usedHookIds = hooks.map((h) => h.id);
    text = await runHookStage(text, hooks, input.userPrompt);
    stagesCompleted.push('hooks');
  }

  // --- Stage 3: Humanize (always for creator prose — quality bar) ---
  let humanizePasses: string[] | undefined;
  const shouldHumanize = input.humanizeAlways || isProse;

  if (shouldHumanize) {
    const humanized = await humanizePipeline(text, {
      profile: null,
      skipVoice: true,
      skipAudit: false,
    });
    text = humanized.text;
    humanizePasses = humanized.passes;
    stagesCompleted.push('humanize');
  }

  // --- Stage 4: Voice ---
  if (useVoice && profile) {
    const voiceSystem = buildSystemPrompt(profile, fullContext || undefined);
    const voicePrompt = `Apply this creator's voice to the draft below. Keep topic and facts identical.

ORIGINAL REQUEST:
${input.userPrompt}

DRAFT:
---
${text}
---

Return ONLY the final post.`;

    text = stripEmDashes(await chatCompletion(voiceSystem, voicePrompt, { temperature: 0.68 }));
    stagesCompleted.push('voice');
  }

  // --- Stage 5: Evaluate + revise (voice fidelity) ---
  let evaluation: VoiceEvaluationMatrix | undefined;
  let revised = false;
  let iterations = 0;
  const maxIterations = input.maxIterations ?? 2;

  if (!skipEval && useVoice) {
    const evalContentType =
      contentType === 'reply' || contentType === 'comment' ? contentType : 'post';

    for (let i = 0; i < maxIterations; i++) {
      iterations = i + 1;
      evaluation = await evaluateDraft(text, profile, fullContext || undefined, evalContentType);

      if (evaluationPasses(evaluation)) break;

      revised = i > 0;
      const revisePrompt = `Rewrite from scratch. Previous draft failed voice QA.

ORIGINAL REQUEST:
${input.userPrompt}

REVISION NOTES:
${evaluation.revision_notes || 'Sound more like the creator. Less generic.'}

Return ONLY the new text.`;

      const voiceSystem = buildSystemPrompt(profile, fullContext || undefined);
      text = stripEmDashes(await chatCompletion(voiceSystem, revisePrompt, { temperature: 0.7 }));

      // Re-humanize after revise if slop crept back in
      if (evaluation.ai_slop > 3) {
        const reHumanized = await humanizePipeline(text, { profile, contextAdditions: fullContext, skipAudit: true });
        text = reHumanized.text;
      }
    }
    stagesCompleted.push('evaluate');
  }

  return finalizeResult(
    text,
    evaluation,
    revised,
    evaluation && !evaluation.pass ? ['below_voice_threshold'] : [],
    stagesCompleted,
    humanizePasses,
    usedHookIds,
    iterations,
  );
}

function finalizeResult(
  text: string,
  evaluation: VoiceEvaluationMatrix | undefined,
  revised: boolean,
  flags: string[],
  stagesCompleted: PipelineStage[],
  humanizePasses: string[] | undefined,
  usedHookIds: string[] | undefined,
  iterations = 0,
): ContentPipelineResult {
  const voice_match_score = evaluation
    ? Math.round((evaluation.persona_fidelity / 10) * 100)
    : 0;
  const ai_score = evaluation ? evaluation.ai_slop * 10 : 0;

  return {
    text,
    voice_match_score,
    ai_score,
    revised,
    flags,
    evaluation,
    iterations,
    usedHookIds,
    stagesCompleted,
    humanizePasses,
  };
}
