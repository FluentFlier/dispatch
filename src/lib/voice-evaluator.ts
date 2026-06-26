import { type CreatorProfileForPrompt } from '@/lib/ai';
import { generateContentHF } from '@/lib/huggingface';

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

export function evaluationPasses(matrix: VoiceEvaluationMatrix): boolean {
  return (
    matrix.persona_fidelity >= PASS_THRESHOLD &&
    matrix.uniqueness >= PASS_THRESHOLD &&
    matrix.specificity >= PASS_THRESHOLD &&
    matrix.so_what >= PASS_THRESHOLD &&
    matrix.pain_resonance >= PASS_THRESHOLD &&
    matrix.ai_slop <= 3
  );
}

export async function evaluateDraft(
  draft: string,
  profile: CreatorProfileForPrompt | null,
  contextAdditions?: string,
  contentType: 'post' | 'reply' | 'comment' = 'post',
): Promise<VoiceEvaluationMatrix> {
  const prompt = `Content type: ${contentType}

CREATOR VOICE:
${profile?.voice_description ?? 'Not set'}
${profile?.voice_rules ? `RULES:\n${profile.voice_rules}` : ''}
${profile?.bio_facts ? `FACTS:\n${profile.bio_facts}` : ''}

DRAFT:
---
${draft}
---`;

  const fallback: VoiceEvaluationMatrix = {
    persona_fidelity: 7,
    uniqueness: 7,
    specificity: 7,
    so_what: 7,
    pain_resonance: 7,
    ai_slop: 4,
    revision_notes: '',
    pass: false,
  };

  try {
    const raw = await generateContentHF(EVALUATOR_PROMPT, prompt);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback;

    const parsed = JSON.parse(jsonMatch[0]) as Partial<VoiceEvaluationMatrix>;
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
    matrix.pass = evaluationPasses(matrix);
    return matrix;
  } catch {
    return fallback;
  }
}
