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

const HARD_RULES = `HARD RULES:
- Plain text only. No markdown, no **bold**, no # headers, no bullet asterisks.
- No em dashes anywhere. Ever.
- No corporate speak, no "in today's world", no "game-changer", no "let's dive in".
- Concrete details over vague claims. Talk TO the reader.
- Group sentences into real paragraphs of 2-4 sentences each. Never put a single
  sentence alone on its own line except the opening hook and the final question.
  Do not treat "Hook/Setup/Story/Insight/CTA" labels in the instructions as a
  cue to start a new one-sentence paragraph per label — merge them into flowing
  prose.
- Use one blank line between paragraphs, never between individual sentences.`;

/** Keep only the first N non-empty lines of a rule list (small models drop long lists). */
function limitLines(text: string, max: number): string {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, max)
    .join('\n');
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

  parts.push(HARD_RULES);

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

  return `You are an editor doing one final pass on a social post draft. Fix ONLY AI tells; keep everything else verbatim, including line breaks.

AI TELLS TO FIX:
- Overused AI words: delve, tapestry, leverage, foster, landscape, nuanced, multifaceted, comprehensive, robust, holistic, pivotal, transformative, utilize, seamless, elevate, empower, unlock, harness
- Throat-clearing ("in today's world", "it's worth noting") and filler conclusions ("in conclusion", "at the end of the day")
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

  // Single evaluation for scoring - relaxed threshold, no revise loop. A small
  // model revising off a small model's notes destroys more than it fixes.
  let evaluation: VoiceEvaluationMatrix | undefined;
  if (useVoice && profile) {
    const evalContentType =
      contentType === 'reply' || contentType === 'comment' ? contentType : 'post';
    const evalContext =
      contentType === 'post' ? stripSections(input.contextAdditions, ['EMAIL VOICE']) : input.contextAdditions;
    evaluation = await evaluateDraft(text, profile, evalContext || undefined, evalContentType, 7);
    stagesCompleted.push('evaluate');
  }

  return finalizeResult(
    text,
    true,
    evaluation,
    false,
    evaluation && !evaluation.pass ? ['below_voice_threshold'] : [],
    stagesCompleted,
    ['pre_clean', 'clean'],
    undefined,
    evaluation ? 1 : 0,
    undefined,
  );
}
