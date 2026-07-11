import { chatCompletion } from '@/lib/llm';
import { evaluateDraft } from '@/lib/voice-evaluator';
import type { VoiceEvaluationMatrix } from '@/lib/voice-evaluator';
import {
  PLATFORM_PLAYBOOKS,
  CONTENT_TYPE_HINTS,
  type VoicePlatform,
  type VoiceContentType,
} from '@/lib/voice-prompts';
import { deterministicPreClean } from '@/lib/humanizer';
import { voiceEvidenceOnly, stripSections, substanceContextOnly, VOICE_EVIDENCE_HEADERS } from './context-split';
import { finalizeResult, stripEmDashes } from './finalize';
import type { ContentPipelineInput, ContentPipelineResult } from './index';
import { styleRulesFromChecks, runChecks, hardFailures, type CheckContext } from './checks';
import { targetedRevise, escalateOnce, selectBest, type EnforceCandidate } from './enforce';
import { SLOP_WORDS, SLOP_PHRASES } from './slop-lexicon';

/**
 * Compact 2-call pipeline for small models (Llama-8B on the HF router, Groq
 * dev models). The full 5-stage pipeline is a chain of 6-11 full rewrites -
 * every hop drifts a small model toward generic slop (audit P0-4). Compact
 * mode instead: (1) ONE voice-grounded draft where the persona + few-shot
 * examples shape the text from the first token, (2) ONE guarded minimal-edit
 * pass that removes AI tells without touching the voice, then a single
 * relaxed-threshold evaluation for scoring (no revise loop).
 */

const VALID_PLATFORMS = new Set<string>(['twitter', 'linkedin', 'instagram', 'threads']);

/** Model-size suffixes that indicate a small model (1B-14B). */
const SMALL_MODEL_RE = /(^|[^0-9.])(1|1\.5|2|3|4|7|8|9|11|13|14)[bB]([^a-zA-Z0-9]|$)/;

/**
 * Compact-mode switch. Explicit LLM_PIPELINE_MODE env wins; otherwise
 * auto-detect from the model id that will actually serve the call.
 */
export function isCompactMode(modelOverride?: string): boolean {
  const mode = process.env.LLM_PIPELINE_MODE?.trim().toLowerCase();
  if (mode === 'compact') return true;
  if (mode === 'full') return false;
  const model =
    modelOverride || process.env.LLM_MODEL?.trim() || 'meta-llama/Llama-3.1-8B-Instruct';
  return SMALL_MODEL_RE.test(model);
}

/** Keep only the first N non-empty lines of a rule list (small models drop long lists). */
function limitLines(text: string, max: number): string {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, max)
    .join('\n');
}

/** Same shape as index.ts's buildCheckContext - duplicated locally (not
 * imported) because ContentPipelineInput and CheckContext live in files that
 * would otherwise import each other circularly. */
function buildCheckContext(input: ContentPipelineInput): CheckContext {
  const useVoice = input.useVoice !== false;
  const profile = useVoice ? input.profile : null;
  return {
    platform: input.platform,
    contentType: input.contentType ?? 'post',
    sourceContext: input.contextAdditions,
    userPrompt: input.userPrompt,
    profile: profile ? { display_name: profile.display_name } : null,
    mentions: input.mentions,
  };
}

function buildCompactDraftSystem(input: ContentPipelineInput): string {
  const useVoice = input.useVoice !== false;
  const profile = useVoice ? input.profile : null;
  const contentType = (input.contentType ?? 'post') as VoiceContentType;
  const parts: string[] = [];

  if (profile) {
    parts.push(
      `You are ghostwriting a social post for ${profile.display_name}. Write it the way THEY write: their vocabulary, sentence framing, rhythm, and structure. The VOICE EVIDENCE below is authoritative.`,
    );
    if (profile.voice_description) parts.push(`VOICE:\n${profile.voice_description}`);
    if (profile.voice_rules) parts.push(`VOICE RULES (MUST FOLLOW):\n${limitLines(profile.voice_rules, 8)}`);
  } else {
    parts.push(
      `You are a sharp human writer drafting a social post. Direct, specific, conversational. One clear idea per post.`,
    );
  }

  parts.push(styleRulesFromChecks(buildCheckContext(input)));

  if (input.platform && VALID_PLATFORMS.has(input.platform)) {
    parts.push(PLATFORM_PLAYBOOKS[input.platform as VoicePlatform]);
  }
  parts.push(`CONTENT TYPE: ${CONTENT_TYPE_HINTS[contentType]}`);

  if (input.structural?.hook_pattern?.trim()) {
    parts.push(`OPENING (authoritative): Open the post the way this creator opens: ${input.structural.hook_pattern.trim()}`);
  }
  if (input.mentions?.length) {
    parts.push(
      `Include these @mentions naturally where relevant: ${input.mentions.map((m) => (m.startsWith('@') ? m : `@${m}`)).join(', ')}`,
    );
  }

  // Context: email voice never belongs in a public post. Voice-on gets facts +
  // voice evidence (evidence LAST - recency bias helps small models); voice-off
  // gets substance only.
  const additions =
    contentType === 'post' ? stripSections(input.contextAdditions, ['EMAIL VOICE']) : input.contextAdditions;
  if (profile && additions) {
    const evidence = voiceEvidenceOnly(additions);
    const rest = stripSections(additions, VOICE_EVIDENCE_HEADERS);
    if (rest) parts.push(`CONTEXT (facts you may draw on - never invent beyond them):\n${rest}`);
    if (evidence) {
      parts.push(
        `VOICE EVIDENCE (authoritative - write the new post the way these are written; match vocabulary, rhythm, and structure exactly, never copy topics):\n${evidence}`,
      );
    }
  } else if (!profile) {
    const substance = substanceContextOnly(input.contextAdditions);
    if (substance) parts.push(`CONTEXT (facts you may draw on):\n${substance}`);
  }

  return parts.join('\n\n');
}

function buildCompactEditSystem(input: ContentPipelineInput): string {
  const preserve = [
    ...(input.vocabulary?.uses_often ?? []),
    ...(input.vocabulary?.signature_phrases ?? []),
  ]
    .map((w) => w.trim())
    .filter(Boolean);

  const sampleWords = SLOP_WORDS.slice(0, 30).map((e) => e.pattern).join(', ');
  const samplePhrases = SLOP_PHRASES.filter((e) => !e.isRegex).slice(0, 10).map((e) => e.pattern).join('; ');

  return `You are an editor doing one final pass on a social post draft. Fix ONLY AI tells; keep everything else verbatim, including line breaks.

AI TELLS TO FIX:
- Overused AI words (not exhaustive - use judgment for others like these): ${sampleWords}
- Throat-clearing and filler phrases (not exhaustive): ${samplePhrases}
- Perfect three-point symmetry, artificial balance, uniform paragraph lengths
- Em dashes (replace with commas or periods), markdown syntax, chatbot phrases, fake enthusiasm

RULES:
- Minimal edit: change only offending words or sentences. Never rewrite the draft.
- Keep all facts, names, numbers, the opening hook, and the paragraph structure.
- Plain text only. No em dashes. Not longer than the original.${preserve.length ? `\n- PRESERVE these creator words/phrases exactly (their real voice): ${preserve.join(', ')}` : ''}

Return ONLY the final post.`;
}

export async function runCompactPipeline(
  input: ContentPipelineInput,
): Promise<ContentPipelineResult> {
  const useVoice = input.useVoice !== false;
  const profile = useVoice ? input.profile : null;
  const contentType = input.contentType ?? 'post';
  const preserve = [
    ...(input.vocabulary?.uses_often ?? []),
    ...(input.vocabulary?.signature_phrases ?? []),
  ];

  // Call 1: voice-grounded draft.
  const draftSystem = buildCompactDraftSystem(input);
  const system = input.systemOverride ? `${input.systemOverride}\n\n${draftSystem}` : draftSystem;
  let text = stripEmDashes(
    await chatCompletion(system, input.userPrompt, {
      temperature: 0.7,
      maxTokens: 1200,
      model: input.model,
    }),
  );
  const stagesCompleted: ContentPipelineResult['stagesCompleted'] = ['base'];

  if (input.fast) {
    return finalizeResult(text, true, undefined, false, [], stagesCompleted, undefined, undefined);
  }

  // Call 2: guarded minimal edit (cheap deterministic pre-clean first).
  text = deterministicPreClean(text, preserve);
  text = stripEmDashes(
    await chatCompletion(buildCompactEditSystem(input), `DRAFT:\n---\n${text}\n---`, {
      temperature: 0.4,
      maxTokens: 1200,
      model: input.model,
    }),
  );
  stagesCompleted.push('humanize');

  // --- Enforcement gate (spec 3.2): runs after call 2 in compact mode ---
  // True worst-case call count (doc correction - the plan said +2, it's +3):
  // Gate A targetedRevise adds +1 chatCompletion, Gate B escalateOnce's
  // regenerate adds +1 chatCompletion, and re-evaluating the escalated
  // candidate adds +1 evaluateDraft. So worst case is 4 chatCompletion calls
  // (draft, edit, targeted-revise, escalation-edit) + up to 2 evaluateDraft
  // calls (initial + escalated) = 6 LLM calls total, never more - escalation
  // is bounded to run at most once regardless of outcome.
  const checkCtx = buildCheckContext(input);
  const gate = await targetedRevise(text, checkCtx, input.model);
  text = gate.text;
  // task5: emit targeted_revise when gate.revisedForChecks

  // Single evaluation for scoring - relaxed threshold, no revise loop. A small
  // model revising off a small model's notes destroys more than it fixes.
  let evaluation: VoiceEvaluationMatrix | undefined;
  const evalContentType = contentType === 'reply' || contentType === 'comment' ? contentType : 'post';
  const evalContext = contentType === 'post' ? stripSections(input.contextAdditions, ['EMAIL VOICE']) : input.contextAdditions;
  if (useVoice && profile) {
    evaluation = await evaluateDraft(text, profile, evalContext || undefined, evalContentType, 7);
    stagesCompleted.push('evaluate');
  }

  const candidates: EnforceCandidate[] = [{ text, checkResults: gate.checkResults, evaluation }];
  const stillHardFailing = hardFailures(gate.checkResults).length > 0;
  const judgeFailing = Boolean(evaluation && !evaluation.pass && !evaluation.parse_error);
  if (stillHardFailing || judgeFailing) {
    const escalatedText = await escalateOnce(async (smartModel) => {
      // task5: emit escalated
      const preCleaned = deterministicPreClean(text, preserve);
      return stripEmDashes(
        await chatCompletion(buildCompactEditSystem(input), `DRAFT:\n---\n${preCleaned}\n---`, {
          temperature: 0.4,
          maxTokens: 1200,
          model: smartModel,
        }),
      );
    });
    if (escalatedText) {
      const escChecks = runChecks(escalatedText, checkCtx);
      let escEvaluation: VoiceEvaluationMatrix | undefined;
      if (useVoice && profile) {
        escEvaluation = await evaluateDraft(escalatedText, profile, evalContext || undefined, evalContentType, 7);
      }
      candidates.push({ text: escalatedText, checkResults: escChecks, evaluation: escEvaluation });
    }
  }

  const best = selectBest(candidates);
  text = best.text;
  evaluation = best.evaluation;
  const finalHardFails = hardFailures(best.checkResults);
  // task5: emit hard_check_failed when finalHardFails.length (best still fails after Gate B)
  const flags = [
    ...(evaluation && !evaluation.pass ? ['below_voice_threshold'] : []),
    ...(finalHardFails.length ? ['hard_check_failed', ...finalHardFails.map((f) => f.id)] : []),
  ];
  // task5: emit shipped_below_threshold when evaluation && !evaluation.pass (ships anyway - best-of already ran)

  return finalizeResult(
    text,
    true,
    evaluation,
    false,
    flags,
    stagesCompleted,
    ['pre_clean', 'clean'],
    undefined,
    evaluation ? 1 : 0,
    undefined,
  );
}
