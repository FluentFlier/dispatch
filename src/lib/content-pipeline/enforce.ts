import { chatCompletion } from '@/lib/llm';
import { checkGlobalLlmBudget } from '@/lib/llm-budget';
import { runChecks, hardFailures, type CheckContext, type CheckResult } from './checks';
import { stripEmDashes } from './finalize';
import { emitPipelineEvent } from './events';
import type { VoiceEvaluationMatrix } from '@/lib/voice-evaluator';

/**
 * Enforcement core (spec 3.2): shared by the full and compact pipelines so
 * the check-gate -> targeted-revise -> escalate-once -> best-of-select flow
 * exists exactly once. targetedRevise/escalateOnce emit their own
 * pipeline_events rows (hard_check_failed/targeted_revise/escalated) since
 * this is the one place both pipelines' gates run through - callers
 * (index.ts, compact.ts) still own the final-state events
 * (shipped_below_threshold, judge_parse_error) at their own decision points.
 */

export interface EnforceCandidate {
  text: string;
  checkResults: CheckResult[];
  evaluation?: VoiceEvaluationMatrix;
}

/**
 * Secondary tiebreaker for best-of selection. Hard checks dominate
 * (candidateScore weights hardPassCount * 1000); this is bounded roughly
 * -10..48 and only matters when two candidates tie on hard-pass count.
 */
export function judgeComposite(evaluation?: VoiceEvaluationMatrix): number {
  if (!evaluation || evaluation.parse_error) return 0;
  return (
    evaluation.persona_fidelity + evaluation.uniqueness + evaluation.specificity +
    evaluation.so_what + evaluation.pain_resonance - evaluation.ai_slop
  );
}

export function candidateScore(c: EnforceCandidate): number {
  const hardPassCount = c.checkResults.filter((r) => r.severity === 'hard' && r.pass).length;
  return hardPassCount * 1000 + judgeComposite(c.evaluation);
}

/** Picks the highest-scoring candidate; ties keep the earliest (stable). */
export function selectBest(candidates: EnforceCandidate[]): EnforceCandidate {
  return candidates.reduce((best, c) => (candidateScore(c) > candidateScore(best) ? c : best));
}

/**
 * Builds the targeted-revise prompt from ONLY the failed checks' evidence +
 * fixHint (spec: specific-failure revision converges, generic "make it
 * better" oscillates - this is the f3b5a5c-class fix at the enforcement
 * layer).
 */
export function buildTargetedRevisePrompt(text: string, fails: CheckResult[]): string {
  const notes = fails
    .map((f) => `- ${f.id}: ${f.fixHint ?? 'fix this issue'}${f.evidence ? ` (found: "${f.evidence}")` : ''}`)
    .join('\n');
  return `Fix ONLY the issues listed below. Keep everything else - topic, facts, structure, length - unchanged.

CURRENT DRAFT:
---
${text}
---

ISSUES TO FIX:
${notes}

Return ONLY the corrected post.`;
}

/**
 * Runs one bounded targeted revise on the SAME model when hard checks fail.
 * No LLM call (no-op) when everything already passes.
 */
export async function targetedRevise(
  text: string,
  ctx: CheckContext,
  model: string | undefined,
  requestId: string,
  stage: string,
): Promise<{ text: string; checkResults: CheckResult[]; revisedForChecks: boolean }> {
  const checkResults = runChecks(text, ctx);
  const fails = hardFailures(checkResults);
  if (fails.length === 0) return { text, checkResults, revisedForChecks: false };

  await emitPipelineEvent({ requestId, event: 'hard_check_failed', detail: { stage, checkIds: fails.map((f) => f.id) } });

  const revisedText = stripEmDashes(
    await chatCompletion(
      'You are a precise editor. Fix only what is asked; never rewrite from scratch.',
      buildTargetedRevisePrompt(text, fails),
      { temperature: 0.4, maxTokens: 1200, model },
    ),
  );
  await emitPipelineEvent({ requestId, event: 'targeted_revise', detail: { stage, checkIds: fails.map((f) => f.id) } });
  return { text: revisedText, checkResults: runChecks(revisedText, ctx), revisedForChecks: true };
}

/**
 * Escalates ONCE to the smart model tier, wrapped in the global llm-budget
 * guard. `regenerate` produces the escalated candidate text - the caller
 * supplies the stage-appropriate regeneration (full pipeline: rerun
 * voice+revise; compact: rerun the edit pass). Returns null (never throws)
 * when the smart tier is unconfigured or the budget is blocked, so an
 * escalation attempt is always best-effort - it can only improve the
 * best-of set, never fail the request.
 */
export async function escalateOnce(
  regenerate: (smartModel: string) => Promise<string>,
  requestId: string,
  stage: string,
): Promise<string | null> {
  const { resolveModel } = await import('@/lib/ai-tiers');
  const smartModel = resolveModel('smart');
  if (!smartModel) return null;
  if ((await checkGlobalLlmBudget()) === 'blocked') return null;
  const text = await regenerate(smartModel);
  await emitPipelineEvent({ requestId, event: 'escalated', detail: { stage, to_model: smartModel } });
  return text;
}
