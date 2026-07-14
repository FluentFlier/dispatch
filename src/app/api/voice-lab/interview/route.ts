import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/insforge/server';
import { generateContent } from '@/lib/ai';
import { guardAiRequest } from '@/lib/ai-guard';
import { errorResponse } from '@/lib/api-errors';
import { z } from 'zod';

const InterviewSchema = z.object({
  analysis: z.record(z.string(), z.unknown()),
  answers: z.array(z.object({
    questionId: z.string(),
    question: z.string(),
    answer: z.string().min(1).max(2000),
  })),
});

const SYNTHESIZE_PROMPT = `You are a voice synthesis expert. Given a voice analysis and interview answers, produce the final persona profile.

Return ONLY valid JSON. Critical: all string values must be single-line - use \\n for line breaks, never actual newlines inside string values.

Return JSON:
{
  "voice_description": "A rich 3-4 sentence description of how this person writes. Be specific, cite patterns.",
  "voice_rules": "Line-separated rules the AI MUST follow when writing as this person. Format: DO: x / NEVER: y. At least 8 rules. Use \\n between rules.",
  "vocabulary_fingerprint": {
    "uses_often": ["word1", "word2"],
    "never_uses": ["word1", "word2"],
    "signature_phrases": ["phrase1", "phrase2"]
  },
  "structural_patterns": {
    "avg_sentence_length": "short/medium/long",
    "paragraph_style": "description",
    "hook_pattern": "description",
    "closing_pattern": "description"
  },
  "exportable_prompt": "A complete system prompt (200-400 words) that any LLM can use to write in this person's voice. Include voice rules, vocabulary guidance, structural patterns, and tone. Make it self-contained and portable. Use \\n for line breaks."
}`;

/**
 * Escapes raw control characters inside JSON string values so JSON.parse doesn't throw.
 * AI models occasionally emit literal newlines/tabs inside JSON strings instead of \\n/\\t,
 * which is invalid JSON. Targets only content inside double-quoted strings.
 */
function sanitizeJsonControlChars(raw: string): string {
  return raw.replace(
    /"((?:[^"\\]|\\[\s\S])*)"/g,
    (_, content: string) =>
      '"' +
      content
        .replace(/\r\n/g, '\\n')
        .replace(/\n/g, '\\n')
        .replace(/\r/g, '\\r')
        .replace(/\t/g, '\\t')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '') +
      '"',
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = InterviewSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const guard = await guardAiRequest(user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const prompt = `Voice Analysis:\n${JSON.stringify(parsed.data.analysis, null, 2)}\n\nInterview Answers:\n${parsed.data.answers.map(a => `Q: ${a.question}\nA: ${a.answer}`).join('\n\n')}`;

  try {
    const result = await generateContent(prompt, undefined, SYNTHESIZE_PROMPT);

    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Failed to parse synthesis' }, { status: 500 });
    }

    let persona: unknown;
    try {
      persona = JSON.parse(jsonMatch[0]);
    } catch {
      // AI emitted literal control characters inside JSON string values (common with long
      // multiline fields like exportable_prompt). Sanitize then retry.
      persona = JSON.parse(sanitizeJsonControlChars(jsonMatch[0]));
    }

    return NextResponse.json(persona);
  } catch (err) {
    return errorResponse('Synthesis failed.', 500, err);
  }
}
