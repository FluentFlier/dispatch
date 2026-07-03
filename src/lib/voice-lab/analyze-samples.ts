import { generateContent } from '@/lib/ai';
import { parseLlmJson } from '@/lib/llm-json';
import type { VoiceAnalysisResult } from '@/lib/onboarding/baseline';

const ANALYZE_PROMPT = `You are a voice analysis expert. Analyze these content samples and extract the creator's unique voice profile.

Samples may include PUBLIC POSTS (LinkedIn, X) and PRIVATE EMAILS. Emails reveal how they write 1:1 — greeting style, explanation patterns, warmth, directness. Posts reveal public performance voice. Synthesize BOTH into one coherent persona.

For each dimension, provide specific observations with examples from their actual writing:

1. **Tone**: Overall emotional register (casual/professional/irreverent/earnest/etc)
2. **Sentence Structure**: Average length, fragment usage, run-ons, punctuation quirks
3. **Vocabulary Level**: Simple/complex, jargon usage, slang, made-up words
4. **Opening Patterns**: How they start posts (question, bold claim, story, etc)
5. **Closing Patterns**: How they end (CTA, open question, punchline, fade out)
6. **Signature Phrases**: Recurring expressions, catchphrases, verbal tics
7. **Humor Style**: None/dry/self-deprecating/absurdist/sarcastic
8. **Perspective**: First person heavy? "You" directed? Third person?
9. **Taboo Words**: Words/phrases they NEVER use (identify by absence)
10. **Content Structure**: Short punchy paragraphs? Long form? Listicles? Thread style?

Also identify 3-5 GAP QUESTIONS -- things you CANNOT determine from the samples alone that would help complete the voice profile.

Return as JSON:
{
  "analysis": {
    "tone": "...",
    "sentence_structure": "...",
    "vocabulary_level": "...",
    "opening_patterns": "...",
    "closing_patterns": "...",
    "signature_phrases": ["...", "..."],
    "humor_style": "...",
    "perspective": "...",
    "taboo_words": ["...", "..."],
    "content_structure": "..."
  },
  "voice_summary": "A 2-3 sentence natural language description of their voice",
  "voice_rules": ["DO: ...", "DO: ...", "NEVER: ...", "NEVER: ..."],
  "gap_questions": [
    {"id": "q1", "question": "...", "why": "..."}
  ]
}`;

export interface AnalyzeSample {
  content: string;
  platform?: string;
}

/**
 * Runs LLM voice analysis on content samples. Shared by Voice Lab API and
 * onboarding ingest so both paths produce identical analysis shape.
 */
export async function analyzeVoiceSamples(
  samples: AnalyzeSample[],
): Promise<VoiceAnalysisResult> {
  const samplesText = samples
    .map((s, i) => `--- Sample ${i + 1}${s.platform ? ` (${s.platform})` : ''} ---\n${s.content}`)
    .join('\n\n');

  const userPrompt = `Here are ${samples.length} content samples to analyze:\n\n${samplesText}`;

  let analysis = parseLlmJson<VoiceAnalysisResult>(
    await generateContent(userPrompt, undefined, ANALYZE_PROMPT),
  );

  if (!analysis) {
    const retrySystem = `${ANALYZE_PROMPT}\n\nIMPORTANT: Return ONLY a single valid JSON object. No markdown, no prose.`;
    analysis = parseLlmJson<VoiceAnalysisResult>(
      await generateContent(userPrompt, undefined, retrySystem),
    );
  }

  if (!analysis) {
    throw new Error('Failed to parse voice analysis');
  }

  return analysis;
}

export { ANALYZE_PROMPT };
