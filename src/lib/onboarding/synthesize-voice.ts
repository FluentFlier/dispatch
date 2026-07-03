import { generateContent } from '@/lib/ai';
import type { VoiceAnalysisResult } from '@/lib/onboarding/baseline';

export interface OnboardingPersona {
  voice_description: string;
  voice_rules: string;
  vocabulary_fingerprint: Record<string, unknown>;
  structural_patterns: Record<string, unknown>;
  exportable_prompt: string;
}

const FAST_SYNTHESIZE_PROMPT = `You are a voice synthesis expert. Given a voice analysis from real posts, produce a final persona profile WITHOUT interview answers — infer anything missing from the samples.

Return ONLY valid JSON. Use \\n for line breaks inside strings, never literal newlines.

{
  "voice_description": "3-4 sentence description of how this person writes",
  "voice_rules": "Line-separated DO/NEVER rules. At least 8 rules. Use \\n between rules.",
  "vocabulary_fingerprint": {
    "uses_often": ["word1"],
    "never_uses": ["word1"],
    "signature_phrases": ["phrase1"]
  },
  "structural_patterns": {
    "avg_sentence_length": "short/medium/long",
    "paragraph_style": "description",
    "hook_pattern": "description",
    "closing_pattern": "description"
  },
  "exportable_prompt": "Complete system prompt 200-400 words for writing in this voice"
}`;

/**
 * Fast-path persona synthesis for onboarding — skips gap-question interview
 * so users reach their Creator Baseline in one shot (Stanley-style speed).
 */
export async function synthesizePersonaFromAnalysis(
  analysis: VoiceAnalysisResult,
): Promise<OnboardingPersona> {
  const prompt = `Voice Analysis:\n${JSON.stringify(analysis, null, 2)}`;
  const result = await generateContent(prompt, undefined, FAST_SYNTHESIZE_PROMPT);

  const jsonMatch = result.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to parse persona synthesis');
  }

  let persona: OnboardingPersona;
  try {
    persona = JSON.parse(jsonMatch[0]) as OnboardingPersona;
  } catch {
    const sanitized = jsonMatch[0]
      .replace(/\r\n/g, '\\n')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, '\\t');
    persona = JSON.parse(sanitized) as OnboardingPersona;
  }

  return persona;
}
