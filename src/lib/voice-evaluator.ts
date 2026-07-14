import { type CreatorProfileForPrompt } from '@/lib/ai';
import { chatCompletion } from '@/lib/llm';
import { parseLlmJson } from '@/lib/llm-json';
import { voiceEvidenceOnly } from '@/lib/content-pipeline/context-split';

/** Mirrors Imagine Content Writer internal matrix (1-10 each). */
export interface VoiceEvaluationMatrix {
  persona_fidelity: number;
  uniqueness: number;
  specificity: number;
  so_what: number;
  pain_resonance: number;
  ai_slop: number;
  revision_notes: string;
  pass: boolean;
  /**
   * True when the evaluator response could not be parsed. This is a transient
   * LLM/JSON glitch, NOT a quality judgment, so the pipeline must treat it as
   * "skip revision" and keep the current draft rather than forcing a destructive
   * from-scratch rewrite off a fake failing score.
   */
  parse_error?: boolean;
}

const EVALUATOR_PROMPT = `You evaluate social content drafts for a specific creator.
Score each dimension 1-10. Be brutal. Generic AI slop scores low on persona_fidelity.

Return JSON only:
{
  "persona_fidelity": 1-10,
  "uniqueness": 1-10,
  "specificity": 1-10,
  "so_what": 1-10,
  "pain_resonance": 1-10,
  "ai_slop": 1-10,
  "revision_notes": "Concrete fixes if any score below 8"
}

Scoring guide:
- persona_fidelity: Sounds exactly like their voice rules and examples?
- uniqueness: Fresh angle vs generic creator advice?
- specificity: Concrete details, not vague claims?
- so_what: Clear value for the reader?
- pain_resonance: Speaks to audience pain they care about?
- ai_slop: 10 = obvious bot, 1 = fully human`;

const PASS_THRESHOLD = 8;

export function evaluationPasses(matrix: VoiceEvaluationMatrix, threshold = PASS_THRESHOLD): boolean {
  return (
    matrix.persona_fidelity >= threshold &&
    matrix.uniqueness >= threshold &&
    matrix.specificity >= threshold &&
    matrix.so_what >= threshold &&
    matrix.pain_resonance >= threshold &&
    matrix.ai_slop <= 3
  );
}

export async function evaluateDraft(
  draft: string,
  profile: CreatorProfileForPrompt | null,
  contextAdditions?: string,
  contentType: 'post' | 'reply' | 'comment' = 'post',
  passThreshold = PASS_THRESHOLD,
): Promise<VoiceEvaluationMatrix> {
  // The judge must see the creator's REAL voice - fingerprint, structural
  // patterns, and example posts - or persona_fidelity is scored against an
  // imagined creator and revision notes push the draft AWAY from the actual
  // voice (audit P0-1). Brain/memory/story sections stay out: they are facts,
  // not voice, and only dilute a small judge model.
  const voiceEvidence = voiceEvidenceOnly(contextAdditions);

  const prompt = `Content type: ${contentType}

CREATOR VOICE:
${profile?.voice_description ?? 'Not set'}
${profile?.voice_rules ? `RULES:\n${profile.voice_rules}` : ''}
${profile?.bio_facts ? `FACTS:\n${profile.bio_facts}` : ''}
${voiceEvidence ? `\nVOICE EVIDENCE (the creator's real vocabulary, patterns, and example posts - judge persona_fidelity against THIS, not against a generic idea of them):\n${voiceEvidence}` : ''}

DRAFT:
---
${draft}
---`;

  // Parse failure is not a quality signal. Return a neutral "skip revision"
  // outcome (pass=true so the pipeline stops, parse_error=true so callers can
  // tell it apart from a genuine pass) instead of a fake failing score that
  // would trigger a destructive from-scratch rewrite.
  const skip: VoiceEvaluationMatrix = {
    persona_fidelity: 8,
    uniqueness: 8,
    specificity: 8,
    so_what: 8,
    pain_resonance: 8,
    ai_slop: 3,
    revision_notes: '',
    pass: true,
    parse_error: true,
  };

  try {
    const raw = await chatCompletion(EVALUATOR_PROMPT, prompt, {
      temperature: 0.2,
      maxTokens: 400,
      responseFormat: 'json',
      // Route scoring to the dedicated judge endpoint (LLM_JUDGE_*, e.g. Cerebras).
      // Unconfigured -> falls back to the global primary, preserving prior behavior.
      role: 'judge',
    });
    const parsed = parseLlmJson<Partial<VoiceEvaluationMatrix>>(raw);
    if (!parsed) {
      console.warn('[voice-evaluator] parse_error: evaluator output unparseable, skipping revision');
      return skip;
    }

    const matrix: VoiceEvaluationMatrix = {
      persona_fidelity: parsed.persona_fidelity ?? 7,
      uniqueness: parsed.uniqueness ?? 7,
      specificity: parsed.specificity ?? 7,
      so_what: parsed.so_what ?? 7,
      pain_resonance: parsed.pain_resonance ?? 7,
      ai_slop: parsed.ai_slop ?? 4,
      revision_notes: parsed.revision_notes ?? '',
      pass: false,
    };
    matrix.pass = evaluationPasses(matrix, passThreshold);
    return matrix;
  } catch (err) {
    // Transient LLM/network error - also skip revision rather than nuke the draft.
    console.warn('[voice-evaluator] evaluation call failed, skipping revision', err);
    return skip;
  }
}
