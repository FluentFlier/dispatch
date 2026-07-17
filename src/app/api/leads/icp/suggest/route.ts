import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser } from '@/lib/insforge/server';
import { chatCompletion, LlmError } from '@/lib/llm';

const bodySchema = z.object({
  /** The user's current ICP brief (may be empty on first setup). */
  current_icp: z.string().max(4000).optional(),
  /** What the user has typed so far in the chat box (may be empty). */
  draft: z.string().max(500).optional(),
});

/**
 * POST /api/leads/icp/suggest
 *
 * Google-autocomplete-style refinement chips for the ICP chat. Given the saved
 * ICP and the in-progress draft, returns 3-4 SHORT prompts the user can tap to
 * refine their ICP (e.g. "Narrow to US only", "Add Series A stage"). Stateless,
 * no persistence. On any provider hiccup returns an empty list (the UI just
 * hides the chips) rather than an error - suggestions are a nicety, never a gate.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ suggestions: [] });

  const currentIcp = (parsed.data.current_icp ?? '').trim();
  const draft = (parsed.data.draft ?? '').trim();

  const system = [
    'You suggest short next refinements for a founder defining their Ideal Customer Profile (ICP) for B2B lead discovery.',
    'Return ONLY a JSON array of 3-4 strings. Each string is an imperative refinement the user could tap,',
    'max 6 words, concrete and specific to their ICP (stage, vertical, geography, signals like funding/hiring/YC).',
    'No numbering, no punctuation at the end, no duplicates of what they already said.',
    'Examples: ["Narrow to US only", "Add Series A stage", "Focus on fintech", "Only YC companies"].',
  ].join(' ');

  const userPrompt = [
    currentIcp ? `Current ICP: ${currentIcp}` : 'Current ICP: (none yet)',
    draft ? `They are typing: ${draft}` : '',
    'Suggest refinements as a JSON array of short strings.',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const raw = await chatCompletion(system, userPrompt, {
      maxTokens: 200,
      temperature: 0.6,
      role: 'small',
    });
    const suggestions = parseStringArray(raw);
    return NextResponse.json({ suggestions });
  } catch (err) {
    // Provider down / over quota / unparseable → no chips, no noise.
    if (err instanceof LlmError) return NextResponse.json({ suggestions: [] });
    return NextResponse.json({ suggestions: [] });
  }
}

/** Pulls the first JSON string array out of an LLM reply, tolerating fences/prose. */
function parseStringArray(raw: string): string[] {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start === -1 || end <= start) return [];
  try {
    const arr = JSON.parse(raw.slice(start, end + 1)) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr
      .map((s) => (typeof s === 'string' ? s.trim() : ''))
      .filter(Boolean)
      .slice(0, 4);
  } catch {
    return [];
  }
}
