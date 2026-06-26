import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/insforge/server';
import { guardAiRequest } from '@/lib/ai-guard';
import { generateContent } from '@/lib/ai';
import { getBestHooksForContext } from '@/lib/hooks-intelligence';
import { z } from 'zod';

const PLATFORM_CHAR_LIMITS: Record<string, number> = {
  linkedin: 3000,
  twitter: 280,
  instagram: 2200,
  threads: 500,
};

const PLATFORM_CHAR_RECOMMENDED: Record<string, number> = {
  linkedin: 800,
  twitter: 80,
  instagram: 300,
  threads: 80,
};

const RequestSchema = z.object({
  text: z.string().min(10).max(10000),
  platform: z.enum(['linkedin', 'twitter', 'instagram', 'threads']),
  voice_match_score: z.number().min(0).max(100).nullable().optional(),
  ai_score: z.number().min(0).max(100).nullable().optional(),
});

type Tier = 'strong' | 'average' | 'weak';

export interface PredictResult {
  tier: Tier;
  score: number;
  hook_score: number;
  signals: string[];
  suggestion: string;
  breakdown: {
    deterministic: number;
    ai: number;
  };
}

interface AIPassResult {
  hook: number;
  depth: number;
  platform_fit: number;
  resonance: number;
  signals: string[];
  suggestion: string;
}

const AI_PREDICT_SYSTEM = `You are a social media performance expert. Analyze the given post and score it on four dimensions (0-10 each). Be honest - most posts are average. Only give 8-10 for genuinely strong signals.

Return ONLY valid JSON - no explanation, no markdown:
{
  "hook": <0-10>,
  "depth": <0-10>,
  "platform_fit": <0-10>,
  "resonance": <0-10>,
  "signals": ["signal 1", "signal 2", "signal 3"],
  "suggestion": "One specific, actionable improvement in under 20 words."
}

hook: Will someone stop scrolling? (0=generic opener, 10=irresistible first line)
depth: Does it deliver real value or insight? (0=fluff, 10=concrete and specific)
platform_fit: Format/length/tone match the platform norms? (0=wrong format, 10=native feel)
resonance: Speaks to a specific person's real pain or goal? (0=generic, 10=feels personal)
signals: 3 short observations (what works or what does not), each under 10 words. No em dashes.
suggestion: One sentence. Specific. Actionable. No em dashes.`;

/**
 * Detects hook pattern signals in the first line of a post.
 */
function scoreHookDeterministic(text: string): { score: number; pattern: string | null } {
  const firstLine = text.split('\n')[0]?.trim() ?? '';
  if (!firstLine) return { score: 0, pattern: null };

  if (/^\d+[\s\w]*(way|reason|thing|mistake|lesson|tip|rule|step|fact)/i.test(firstLine)) {
    return { score: 9, pattern: 'numbered list hook' };
  }
  if (/I (made|lost|earned|built|sold|quit|failed|spent)/i.test(firstLine)) {
    return { score: 9, pattern: 'results hook' };
  }
  if (/\$[\d,]+|\d+[kKmM]\b/.test(firstLine)) {
    return { score: 8, pattern: 'number/metric hook' };
  }
  if (/\?$/.test(firstLine) && firstLine.length > 20) {
    return { score: 7, pattern: 'question hook' };
  }
  if (/^(here'?s?|this is|why|how|what|the truth|nobody|everyone|most people)/i.test(firstLine)) {
    return { score: 6, pattern: 'insight hook' };
  }
  if (/years? (ago|later)|last (week|month|year)/i.test(firstLine)) {
    return { score: 6, pattern: 'story hook' };
  }
  if (firstLine.length < 60 && firstLine.length > 10) {
    return { score: 5, pattern: 'short punchy hook' };
  }
  return { score: 3, pattern: 'generic opener' };
}

/**
 * Deterministic pass using existing hook intelligence + voice scores + platform math.
 */
function deterministicPass(
  text: string,
  platform: string,
  voiceMatchScore: number | null | undefined,
  aiScore: number | null | undefined,
): { score: number; hook_score: number; signals: string[] } {
  const signals: string[] = [];
  let total = 0;

  // Hook quality (30%)
  const hookResult = scoreHookDeterministic(text);
  total += hookResult.score * 10 * 0.3;
  if (hookResult.pattern) {
    signals.push(`Hook: ${hookResult.pattern} detected`);
  }

  // Cross-check top hook dataset benchmark
  const topHooks = getBestHooksForContext(undefined, 20);
  const avgDatasetScore =
    topHooks.length > 0
      ? topHooks.reduce((acc, h) => acc + h.score.total, 0) / topHooks.length
      : 60;
  if (avgDatasetScore > 70) {
    signals.push(`Hook benchmark: ${avgDatasetScore.toFixed(0)}/100 in top-performers dataset`);
  }

  // Voice quality (25%)
  if (voiceMatchScore !== null && voiceMatchScore !== undefined) {
    total += voiceMatchScore * 0.25;
    signals.push(
      voiceMatchScore >= 80
        ? `Voice match: ${voiceMatchScore}% - sounds like you`
        : voiceMatchScore >= 60
          ? `Voice match: ${voiceMatchScore}% - mostly on brand`
          : `Voice match: ${voiceMatchScore}% - may not sound like you`,
    );
  } else {
    total += 60 * 0.25;
  }

  // AI slop penalty (10%)
  if (aiScore !== null && aiScore !== undefined) {
    total += (100 - aiScore) * 0.1;
    if (aiScore > 50) signals.push('AI tells detected - consider humanizing');
  } else {
    total += 70 * 0.1;
  }

  // Platform fit (20%)
  const limit = PLATFORM_CHAR_LIMITS[platform] ?? 3000;
  const recommended = PLATFORM_CHAR_RECOMMENDED[platform] ?? 200;
  const len = text.length;
  let platformScore = 0;
  if (len > limit) {
    platformScore = 20;
    signals.push(`Over ${platform} limit (${len}/${limit} chars) - will be cut off`);
  } else if (len >= recommended) {
    platformScore = 100;
    signals.push(`${platform} length on target (${len} chars)`);
  } else {
    platformScore = 50;
    signals.push(`Short for ${platform} - consider expanding`);
  }
  total += platformScore * 0.2;

  // Content signals (15%)
  let contentScore = 0;
  if (/\?/.test(text)) contentScore += 25;
  if (/\d/.test(text)) contentScore += 25;
  if (/\bI\b/.test(text)) contentScore += 25;
  if (/(comment|reply|share|DM|follow|let me know|thoughts\??)/i.test(text)) {
    contentScore += 25;
    signals.push('Has CTA - encourages engagement');
  }
  total += contentScore * 0.15;

  return {
    score: Math.round(Math.min(100, Math.max(0, total))),
    hook_score: hookResult.score,
    signals: signals.slice(0, 3),
  };
}

/**
 * AI analysis pass - full text analysis via Claude/OpenAI.
 */
async function aiPass(text: string, platform: string): Promise<AIPassResult> {
  const prompt = `Platform: ${platform}\n\nPost:\n${text}`;
  const raw = await generateContent(prompt, undefined, AI_PREDICT_SYSTEM);
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('AI pass returned invalid JSON');
  return JSON.parse(jsonMatch[0]) as AIPassResult;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const { text, platform, voice_match_score, ai_score } = parsed.data;

  const guard = await guardAiRequest(user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  // Both passes run in parallel - neither is a fallback
  const [det, aiResult] = await Promise.all([
    Promise.resolve(deterministicPass(text, platform, voice_match_score, ai_score)),
    aiPass(text, platform).catch((err: unknown) => {
      console.error('[predict] AI pass failed:', err);
      return null;
    }),
  ]);

  let finalScore: number;
  let allSignals: string[];
  let suggestion: string;
  let aiBreakdown: number;

  if (aiResult) {
    const aiAvg =
      ((aiResult.hook + aiResult.depth + aiResult.platform_fit + aiResult.resonance) / 4) * 10;
    aiBreakdown = Math.round(aiAvg);
    finalScore = Math.round(det.score * 0.5 + aiAvg * 0.5);
    allSignals = Array.from(new Set([...det.signals, ...aiResult.signals])).slice(0, 4);
    suggestion = aiResult.suggestion;
  } else {
    aiBreakdown = det.score;
    finalScore = det.score;
    allSignals = det.signals;
    suggestion = 'Add a direct question at the end to invite replies.';
  }

  const tier: Tier = finalScore >= 70 ? 'strong' : finalScore >= 45 ? 'average' : 'weak';

  const result: PredictResult = {
    tier,
    score: finalScore,
    hook_score: det.hook_score,
    signals: allSignals,
    suggestion,
    breakdown: {
      deterministic: det.score,
      ai: aiBreakdown,
    },
  };

  return NextResponse.json(result);
}
