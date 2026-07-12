import type { createClient } from '@insforge/sdk';
import { buildSystemPrompt, type CreatorProfileForPrompt } from '@/lib/ai';
import { chatCompletion } from '@/lib/llm';
import { humanizePipeline } from '@/lib/humanizer';
import { evaluateDraft, evaluationPasses, type VoiceEvaluationMatrix } from '@/lib/voice-evaluator';
import { buildVoiceComposeHints, type VoiceContentType } from '@/lib/voice-prompts';
import { getBestHooksForGeneration } from '@/lib/hooks-intelligence/resolve-hooks';
import { PILLAR_TO_VERTICAL, type HookVertical } from '@/lib/hooks-intelligence/types';
import { profilePillarWeights } from '@/lib/pillars';
import { substanceContextOnly, stripSections } from '@/lib/content-pipeline/context-split';
import type { VocabularyFingerprint, StructuralPatterns } from '@/lib/voice-context';
import { finalizeResult, stripEmDashes } from './finalize';
export { stripMarkdownFormatting, enforceParagraphFloor } from './finalize';
import { isCompactMode, runCompactPipeline } from './compact';
import { styleRulesFromChecks, runChecks, hardFailures, type CheckContext } from './checks';
import { targetedRevise, escalateOnce, selectBest, type EnforceCandidate } from './enforce';
import { emitPipelineEvent } from './events';
import { createRequestId } from '@/lib/logger';
import { callStageChecked } from './stage-contract';
import { withSpan, flushAfterResponse } from '@/lib/observability/langfuse';
import { recordGenerationOutcome } from '@/lib/observability/generation-outcome';

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
  /** LinkedIn/X @mentions to weave into the draft naturally. */
  mentions?: string[];
  /**
   * Optional per-call model override for the generation stages (base/hook/voice/
   * revise). Lets a caller request a higher-quality model than the env default
   * for a specific draft. No-op when undefined (uses env LLM_MODEL).
   */
  model?: string;
  /** Optional InsForge client for DB-learned hook retrieval. */
  hooksClient?: InsforgeClient;
  /** Parsed creator fingerprint (voice-on) - drives PRESERVE lists in humanize passes. */
  vocabulary?: VocabularyFingerprint;
  /** Parsed structural patterns (voice-on) - drives creator-first opening style. */
  structural?: StructuralPatterns;
  /** Run the learned-hook rewrite stage even when the creator has their own opening style. */
  forceHooks?: boolean;
  /** Correlates every pipeline_events row for one generation request. Generated
   * internally when omitted - callers only need to pass it if they want to
   * correlate pipeline events with their own request-scoped logging. */
  requestId?: string;
  /** Attached to pipeline_events rows when known; nullable, best-effort. */
  userId?: string;
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
  hookExplanations?: Array<{ id: string; text: string; author: string; rlScore: number; source: string; reason: string }>;
  stagesCompleted: PipelineStage[];
  humanizePasses?: string[];
}

/**
 * Bump the patch suffix on ANY change to a prompt string in this file,
 * compact.ts, humanizer.ts, or voice-evaluator.ts (RUNBOOK rule). Tagged on
 * every Langfuse trace so quality trends segment by prompt generation.
 */
export const PROMPT_VERSION = '2026-07-12.1';

const BASE_SYSTEM = `You are an expert social content strategist writing for real creators.

Your job in this pass: write the SUBSTANCE, the clear message, specific details, strong structure.
Do NOT worry about hooks or personal voice yet. Focus on:
- One clear takeaway the reader cares about
- Concrete details (names, numbers, moments), never vague claims
- Platform-native length and format
- No title or headline unless requested

Write like a smart person outlining their post before polishing it.`;

const HOOK_SYSTEM = `You are a hook specialist for social media creators.

Rewrite ONLY the opening and tighten structure using the hook examples provided.
- First 1-2 lines must stop the scroll (adapt hook STRUCTURE, not copy topics)
- Keep all facts and body content from the draft
- Do not add generic AI phrasing
- The creator's own voice and opening style win on any conflict with the examples`;

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
 * Builds the CheckContext shared by styleRulesFromChecks and the enforcement
 * gates (Task 3+). Single construction site so all three always agree on
 * platform/contentType/mentions for a given request.
 */
function buildCheckContext(
  input: ContentPipelineInput,
  contentType: string,
  sourceContext: string | undefined,
  profile: CreatorProfileForPrompt | null,
): CheckContext {
  return {
    platform: input.platform,
    contentType,
    sourceContext,
    userPrompt: input.userPrompt,
    profile: profile ? { display_name: profile.display_name } : null,
    mentions: input.mentions,
  };
}

/**
 * Stage 1 — Base draft: substance + platform format, minimal voice.
 */
async function runBaseStage(
  input: ContentPipelineInput,
  substanceContext: string | undefined,
  checkCtx: CheckContext,
  requestId: string,
): Promise<string> {
  const composeHints = buildVoiceComposeHints(input.platform, input.contentType ?? 'post', {
    creatorHookPattern: input.structural?.hook_pattern,
  });
  const mentionHint =
    input.mentions && input.mentions.length > 0
      ? `Include these @mentions naturally where relevant: ${input.mentions.map((m) => (m.startsWith('@') ? m : `@${m}`)).join(', ')}`
      : undefined;
  const taskHint = input.platform
    ? `Platform: ${input.platform}. Match native format and length.`
    : undefined;
  const rules = styleRulesFromChecks(checkCtx);

  const merged = [composeHints, taskHint, mentionHint, rules, substanceContext].filter(Boolean).join('\n\n');
  // Even with a systemOverride, keep the merged block (task hint, @mentions,
  // substance context). Previously the override replaced everything but
  // composeHints, so override callers silently lost their mentions and drafted
  // with no substance grounding.
  const system = input.systemOverride
    ? `${input.systemOverride}\n\n${merged}`
    : `${BASE_SYSTEM}\n\n${merged}`;

  return stripEmDashes(
    await callStageChecked(system, input.userPrompt, { temperature: 0.75, model: input.model }, 'base', requestId, ''),
  );
}

/**
 * Stage 2 — Hook layer: apply high-converting openers to the base draft.
 */
async function runHookStage(
  baseText: string,
  hooks: Array<{ id: string; text: string; author: string }>,
  userPrompt: string,
  substanceContext: string | undefined,
  model: string | undefined,
  checkCtx: CheckContext,
  requestId: string,
): Promise<string> {
  if (hooks.length === 0) return baseText;

  const examples = formatHookExamples(hooks);
  // Give the hook stage the same voice signal the base stage got. The structural
  // patterns (how they open) and fingerprint let the opener match the creator's
  // own style instead of a generic scroll-stopper.
  const rules = styleRulesFromChecks(checkCtx);
  const system = [HOOK_SYSTEM, rules, substanceContext].filter(Boolean).join('\n\n');
  const prompt = `ORIGINAL REQUEST:\n${userPrompt}\n\nBASE DRAFT:\n---\n${baseText}\n---\n\nHOOK EXAMPLES (adapt structure to this topic):\n${examples}\n\nRewrite with a stronger hook opening. Return ONLY the full post.`;

  return stripEmDashes(await callStageChecked(system, prompt, { temperature: 0.7, model }, 'hooks', requestId, baseText));
}

/**
 * Four-stage creator pipeline:
 * 1. Base (substance) → 2. Hooks → 3. Humanize (clean + audit) → 4. Voice → evaluate/revise
 *
 * Why this order: mixing voice + anti-slop in one pass averages toward generic.
 * Hooks on substance preserve facts; humanize before voice removes AI tells first;
 * voice last makes it sound like THEM without reintroducing slop.
 */
async function runContentPipelineInner(
  input: ContentPipelineInput,
): Promise<ContentPipelineResult> {
  const stagesCompleted: PipelineStage[] = [];
  const requestId = input.requestId ?? createRequestId();
  const useVoice = input.useVoice !== false;
  const profile = useVoice ? input.profile : null;
  const skipEval = input.fast || !useVoice;
  const substanceContext = substanceContextOnly(input.contextAdditions);
  const fullContext = input.contextAdditions;

  const contentType = input.contentType ?? 'post';
  const isProse = contentType === 'post' || contentType === 'reply' || contentType === 'comment';
  const evalContentType = contentType === 'reply' || contentType === 'comment' ? contentType : 'post';

  // Small models can't survive the full 6-11 rewrite chain - route prose to
  // the 2-call compact pipeline (env LLM_PIPELINE_MODE overrides detection).
  if (isProse && isCompactMode(input.model)) {
    await emitPipelineEvent({
      requestId, userId: input.userId, event: 'compact_mode',
      detail: { model: input.model ?? process.env.LLM_MODEL },
    });
    return runCompactPipeline({ ...input, requestId });
  }

  // --- Stage 1: Base ---
  const baseCheckCtx = buildCheckContext(input, contentType, substanceContext, profile);
  let text = await withSpan('stage:base', { model: input.model ?? process.env.LLM_MODEL ?? 'env-default' },
    () => runBaseStage(input, substanceContext, baseCheckCtx, requestId));
  stagesCompleted.push('base');

  // Voice-off: substance + humanize. "No voice" must still read like a human
  // wrote it - the base draft alone carries every LLM tell, so prose always
  // gets the anti-slop pass (fast mode keeps its speed contract and skips it
  // unless the caller asks).
  if (!useVoice) {
    if (isProse && !input.fast) {
      const h = await humanizePipeline(text, {
        skipVoice: true,
        skipAudit: false,
        vocabulary: input.vocabulary,
      });
      text = h.text;
      stagesCompleted.push('humanize');
      // Gate A (voice-off path): targeted revise runs, no escalation ladder -
      // per this task's scope decision, escalation only exists on the
      // voice-on path (there is nothing to escalate to here). hard_check_failed
      // is emitted inside targetedRevise itself when a hard check first fails.
      const voiceOffCtx = buildCheckContext(input, contentType, fullContext, null);
      const voiceOffGate = await targetedRevise(text, voiceOffCtx, input.model, requestId, 'humanize');
      text = voiceOffGate.text;
      const voiceOffFails = hardFailures(voiceOffGate.checkResults);
      const voiceOffFlags = voiceOffFails.length ? ['hard_check_failed', ...voiceOffFails.map((f) => f.id)] : [];
      return finalizeResult(text, isProse, undefined, false, voiceOffFlags, stagesCompleted, h.passes, undefined);
    }
    if (input.humanizeAlways) {
      const h = await humanizePipeline(text, { skipVoice: true, skipAudit: true });
      text = h.text;
      stagesCompleted.push('humanize');
      return finalizeResult(text, isProse, undefined, false, [], stagesCompleted, h.passes, undefined);
    }
    // revised=false: no revise loop runs on the voice-off path, so the draft was
    // never revised (was mislabeled true, showing a false "(revised)" badge).
    return finalizeResult(text, isProse, undefined, false, [], stagesCompleted, undefined, undefined);
  }

  // Fast mode / non-prose: base + light humanize
  if (input.fast || !isProse) {
    if (input.humanizeAlways || !useVoice) {
      const h = await humanizePipeline(text, { skipVoice: true, skipAudit: true });
      text = h.text;
      stagesCompleted.push('humanize');
      return finalizeResult(text, isProse, undefined, false, [], stagesCompleted, h.passes, undefined);
    }
    // revised=false: fast/non-prose skips the revise loop (was passing skipEval,
    // which is true in fast mode -> a false "(revised)" badge).
    return finalizeResult(text, isProse, undefined, false, [], stagesCompleted, undefined, undefined);
  }

  // --- Stage 2: Hooks ---
  // The creator's own opening style (hook_pattern) is already instructed in the
  // base stage. Rewriting the opener from OTHER creators' hooks on top of it
  // homogenizes output (audit P0-3) - so the learned-hook stage only runs when
  // the creator has no measured opening style, or the caller forces it.
  let usedHookIds: string[] | undefined;
  let hookExplanations: ContentPipelineResult['hookExplanations'];
  const hasOwnOpeningStyle = Boolean(input.structural?.hook_pattern?.trim());
  if (!input.skipHooks && (!hasOwnOpeningStyle || input.forceHooks)) {
    const vertical = topWeightedVertical(profile);
    const nicheId = (profile as { niche_id?: string } | null)?.niche_id;
    const resolved = await getBestHooksForGeneration(input.hooksClient, {
      nicheId,
      topicText: `${input.userPrompt}\n${substanceContext}`.slice(0, 1000),
      vertical,
      limit: 3,
    });
    usedHookIds = resolved.hooks.map((h) => h.id);
    hookExplanations = resolved.explanations;
    if (resolved.usedStaticFallback) {
      await emitPipelineEvent({ requestId, userId: input.userId, event: 'hook_fallback_static', detail: { vertical } });
    }
    text = await withSpan('stage:hooks', { hookCount: resolved.hooks.length },
      () => runHookStage(text, resolved.hooks, input.userPrompt, substanceContext, input.model, baseCheckCtx, requestId));
    stagesCompleted.push('hooks');
  }

  // --- Stage 3: Humanize (always for creator prose — quality bar) ---
  let humanizePasses: string[] | undefined;
  const shouldHumanize = input.humanizeAlways || isProse;

  if (shouldHumanize) {
    const humanized = await withSpan('stage:humanize', {}, () => humanizePipeline(text, {
      profile: null,
      skipVoice: true,
      skipAudit: false,
      vocabulary: input.vocabulary,
    }));
    text = humanized.text;
    humanizePasses = humanized.passes;
    stagesCompleted.push('humanize');
  }

  // --- Gate A: check gate after humanize (spec 3.2) ---
  // Runs for every prose output regardless of voice-on/off - hard checks
  // like em-dash/markdown/fabricated-specifics matter either way. `fast`
  // mode already returned earlier in this function and never reaches here.
  const flags: string[] = [];
  if (isProse) {
    const gateACtx = buildCheckContext(input, contentType, fullContext, profile);
    const gateA = await targetedRevise(text, gateACtx, input.model, requestId, 'humanize');
    text = gateA.text;
  }

  // EMAIL VOICE is a 1:1 register (greetings, sign-offs, warmth) - useful for
  // replies/comments, wrong for public posts. Keep it out of the post rewrite
  // so email tone can't bleed in.
  const voiceStageContext =
    contentType === 'post' ? stripSections(fullContext, ['EMAIL VOICE']) : fullContext;

  // --- Stage 4: Voice ---
  if (useVoice && profile) {
    const voiceSystem = buildSystemPrompt(profile, voiceStageContext || undefined);
    const voicePrompt = `Apply this creator's voice to the draft below. Keep topic and facts identical.

ORIGINAL REQUEST:
${input.userPrompt}

DRAFT:
---
${text}
---

Return ONLY the final post.`;

    const preVoiceText = text;
    text = stripEmDashes(await withSpan('stage:voice', { model: input.model ?? process.env.LLM_MODEL ?? 'env-default' },
      () => callStageChecked(voiceSystem, voicePrompt, { temperature: 0.68, model: input.model }, 'voice', requestId, preVoiceText)));
    stagesCompleted.push('voice');
  }

  // --- Stage 5: Evaluate + revise (voice fidelity) ---
  let evaluation: VoiceEvaluationMatrix | undefined;
  let revised = false;
  let iterations = 0;
  const maxIterations = input.maxIterations ?? 2;

  if (!skipEval && useVoice) {
    let lastActionWasRevise = false;

    for (let i = 0; i < maxIterations; i++) {
      iterations = i + 1;
      evaluation = await withSpan('stage:evaluate', { iteration: i + 1 },
        () => evaluateDraft(text, profile, voiceStageContext || undefined, evalContentType));
      lastActionWasRevise = false;

      if (evaluation.parse_error) {
        await emitPipelineEvent({ requestId, event: 'judge_parse_error', detail: { stage: 'voice-evaluate' } });
      }
      // Parse glitch (not a real quality failure) — keep the draft, stop revising.
      if (evaluation.parse_error) break;
      if (evaluationPasses(evaluation)) break;

      // Revise IN PLACE from the current best draft. Rewriting from scratch here
      // threw away the hook + humanize + voice work already applied, so the hardest
      // drafts got the least polish. Keep topic/facts/structure/hook; fix only the
      // notes.
      const revisePrompt = `Revise the draft below so it sounds more like the creator. Keep the topic, facts, overall structure, and the opening hook. Change ONLY what the revision notes call out. Do not rewrite from scratch.

ORIGINAL REQUEST:
${input.userPrompt}

CURRENT DRAFT:
---
${text}
---

REVISION NOTES:
${evaluation.revision_notes || 'Sound more like the creator. Less generic.'}

Return ONLY the revised post.`;

      const voiceSystem = buildSystemPrompt(profile, voiceStageContext || undefined);
      const preReviseText = text;
      text = stripEmDashes(await callStageChecked(voiceSystem, revisePrompt, { temperature: 0.7, model: input.model }, 'revise', requestId, preReviseText));
      revised = true;
      lastActionWasRevise = true;

      // Re-humanize after revise if slop crept back in
      if (evaluation.ai_slop > 3) {
        const reHumanized = await humanizePipeline(text, {
          profile,
          contextAdditions: voiceStageContext,
          skipAudit: true,
          vocabulary: input.vocabulary,
        });
        text = reHumanized.text;
      }
    }

    // If the loop exited right after a revise (max iterations reached), the last
    // rewrite was never scored — the reported score would reflect the PREVIOUS
    // draft, not the text we return. Re-evaluate the final draft so score matches
    // output. A parse glitch on this final pass keeps the prior evaluation.
    if (lastActionWasRevise) {
      const finalEval = await withSpan('stage:evaluate', { iteration: iterations + 1, final: true },
        () => evaluateDraft(text, profile, voiceStageContext || undefined, evalContentType));
      if (!finalEval.parse_error) evaluation = finalEval;
    }
    stagesCompleted.push('evaluate');
  }

  // --- Gate B: final check gate + bounded escalation (spec 3.2) ---
  const gateBCtx = buildCheckContext(input, contentType, voiceStageContext, profile);
  const finalChecks = runChecks(text, gateBCtx);
  const candidates: EnforceCandidate[] = [{ text, checkResults: finalChecks, evaluation }];

  const stillHardFailing = hardFailures(finalChecks).length > 0;
  const judgeFailing = Boolean(evaluation && !evaluation.pass && !evaluation.parse_error);
  if (stillHardFailing || judgeFailing) {
    const escalatedText = await escalateOnce(async (smartModel) => {
      const voiceSystem = buildSystemPrompt(profile, voiceStageContext || undefined);
      const revisePrompt = `Revise the draft below so it sounds more like the creator and fixes every issue noted. Keep the topic, facts, and overall structure.

ORIGINAL REQUEST:
${input.userPrompt}

CURRENT DRAFT:
---
${text}
---

ISSUES TO FIX:
${[...hardFailures(finalChecks).map((f) => `- ${f.id}: ${f.fixHint}`), evaluation?.revision_notes ? `- voice: ${evaluation.revision_notes}` : ''].filter(Boolean).join('\n')}

Return ONLY the revised post.`;
      return stripEmDashes(
        await chatCompletion(voiceSystem, revisePrompt, { temperature: 0.6, maxTokens: 1200, model: smartModel }),
      );
    }, requestId, 'voice');

    if (escalatedText) {
      const escChecks = runChecks(escalatedText, gateBCtx);
      const escEvaluation = await evaluateDraft(escalatedText, profile, voiceStageContext || undefined, evalContentType);
      candidates.push({ text: escalatedText, checkResults: escChecks, evaluation: escEvaluation });
    }
  }

  const best = selectBest(candidates);
  text = best.text;
  evaluation = best.evaluation;
  const finalHardFails = hardFailures(best.checkResults);
  if (finalHardFails.length > 0) {
    flags.push('hard_check_failed', ...finalHardFails.map((f) => f.id));
    await emitPipelineEvent({ requestId, userId: input.userId, event: 'shipped_below_threshold', detail: { stage: 'final', checkIds: finalHardFails.map((f) => f.id) } });
  }

  return finalizeResult(
    text,
    true,
    evaluation,
    revised,
    [...(evaluation && !evaluation.pass ? ['below_voice_threshold'] : []), ...flags],
    stagesCompleted,
    humanizePasses,
    usedHookIds,
    iterations,
    hookExplanations,
  );
}

/**
 * Public entry: same signature and behavior as runContentPipelineInner. Adds
 * a Langfuse trace (no-op without keys), a fire-and-forget outcome record,
 * and a post-response flush. Phase 4 is observation only - errors here can
 * never fail generation (withSpan/flushAfterResponse never throw on their
 * own, and any error inside the wrapped fn still propagates unchanged).
 *
 * requestId is generated here (once) and threaded into the inner call so the
 * outcome record's request_id matches every degradation event the inner
 * pipeline emits for the same generation - the whole point of a shared
 * request_id (see ContentPipelineInput.requestId doc).
 */
export async function runContentPipeline(
  input: ContentPipelineInput,
): Promise<ContentPipelineResult> {
  const requestId = input.requestId ?? createRequestId();
  try {
    return await withSpan('generation', {
      requestId,
      model: input.model ?? process.env.LLM_MODEL ?? 'env-default',
      promptVersion: PROMPT_VERSION,
      platform: input.platform,
      contentType: input.contentType ?? 'post',
      useVoice: input.useVoice !== false,
    }, async () => {
      const result = await runContentPipelineInner({ ...input, requestId });
      void recordGenerationOutcome(requestId, input, result).catch(() => undefined);
      return result;
    });
  } finally {
    flushAfterResponse();
  }
}
