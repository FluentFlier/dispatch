import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { generateContent } from '@/lib/ai';
import { guardAiRequest } from '@/lib/ai-guard';
import { errorResponse } from '@/lib/api-errors';
import { fetchRecentPostsByKeywords, type RawPost } from '@/lib/hooks-intelligence/mining';

// Grounded extraction: the model only summarizes trends that ACTUALLY appear in
// the scraped posts. A bare LLM has no live data and hallucinates stale launches
// as "trending now" (e.g. a year-old product); feeding it real recent posts is
// the only honest way to detect what people are posting about today.
const TREND_EXTRACT_PROMPT = `You are a social media trend analyst. You are given REAL recent posts scraped from LinkedIn/X for a creator's topics. Identify the genuine trends, recurring themes, and angles that ACTUALLY appear in these posts.

STRICT RULES:
- Only report topics that genuinely appear in the provided posts. NEVER invent product launches, news, dates, or events that are not present in the posts.
- Base "why_trending" on evidence from the posts (recurring themes, high engagement), not outside knowledge.
- If the posts support fewer than 5 real trends, return fewer. Quality over count.
- Do not use em dashes or en dashes anywhere.

For each trend provide: topic, why_trending, angle (a specific angle the creator could take), best_platform (twitter|linkedin|instagram|threads), urgency (immediate|today|this_week), draft_hook (first line of a post), confidence (0.0-1.0).

Return a JSON array only:
[{"topic":"...","why_trending":"...","angle":"...","best_platform":"linkedin","urgency":"this_week","draft_hook":"...","confidence":0.0}]`;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const guard = await guardAiRequest(user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const client = getServerClient();

  // Keywords = creator's content pillars merged with the seed_keywords of any
  // niche whose label matches a pillar. Pillars are per-user; niches are global.
  let pillarNames: string[] = [];
  try {
    const { data: profileRow } = await client.database
      .from('creator_profile')
      .select('content_pillars')
      .eq('user_id', user.id)
      .single();
    const raw = profileRow?.content_pillars;
    const pillars = typeof raw === 'string' ? JSON.parse(raw) : raw;
    pillarNames = (Array.isArray(pillars) ? pillars : [])
      .map((p: { name?: string }) => (p?.name ?? '').trim())
      .filter(Boolean);
  } catch {
    // No profile / unparseable pillars — fall through to the empty-keywords guard.
  }

  const keywords = new Set(pillarNames);
  if (pillarNames.length > 0) {
    const { data: nicheRows } = await client.database
      .from('niches')
      .select('seed_keywords')
      .in('label', pillarNames);
    for (const n of (nicheRows ?? []) as Array<{ seed_keywords: string[] | null }>) {
      for (const k of n.seed_keywords ?? []) if (k?.trim()) keywords.add(k.trim());
    }
  }
  const searchTerms = Array.from(keywords).slice(0, 12);

  // Live trends require the scraper. "Disable and say so" rather than fabricate.
  if (!process.env.APIFY_TOKEN) {
    return NextResponse.json(
      { error: 'Live trend detection needs the scraper configured (set APIFY_TOKEN).' },
      { status: 400 },
    );
  }
  if (searchTerms.length === 0) {
    return NextResponse.json(
      { error: 'Add content pillars first so trends can be detected for your topics.' },
      { status: 400 },
    );
  }

  // Scrape real recent posts for the creator's topics.
  let posts: RawPost[];
  try {
    posts = await fetchRecentPostsByKeywords(searchTerms, 40);
  } catch (err) {
    return errorResponse('Could not scrape recent posts for trend detection.', 502, err);
  }
  posts = posts.filter((p) => p.text && p.text.length > 40);
  if (posts.length === 0) {
    return NextResponse.json({ trends: [], message: 'No recent posts found for your topics yet.' });
  }

  // Digest the highest-engagement posts as grounding evidence for the model.
  const digest = [...posts]
    .sort((a, b) => b.likes + b.comments - (a.likes + a.comments))
    .slice(0, 30)
    .map((p, i) => `${i + 1}. [${p.likes}L/${p.comments}C] ${p.text.replace(/\s+/g, ' ').slice(0, 300)}`)
    .join('\n');

  const prompt = `Creator's topics: ${pillarNames.join(', ') || 'general'}.
Below are ${posts.length} real recent posts scraped for these topics. Identify the genuine trends and angles ACTUALLY present in them. Do not invent anything not in these posts.

POSTS:
${digest}`;

  try {
    const result = await generateContent(prompt, undefined, TREND_EXTRACT_PROMPT);
    const jsonMatch = result.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return NextResponse.json({ error: 'Failed to parse trends' }, { status: 500 });
    }

    const trends = JSON.parse(jsonMatch[0]);

    // Upsert dedups on (user_id, topic); surface a write failure instead of
    // returning trends the dashboard will never see.
    for (const trend of trends) {
      const { error: upsertError } = await client.database.from('detected_trends').upsert({
        user_id: user.id,
        topic: trend.topic,
        why_trending: trend.why_trending,
        angle: trend.angle,
        best_platform: trend.best_platform,
        urgency: trend.urgency,
        draft_hook: trend.draft_hook,
        confidence: trend.confidence,
        detected_at: new Date().toISOString(),
      }, { onConflict: 'user_id,topic' });
      if (upsertError) {
        return errorResponse('Failed to save detected trends.', 500, upsertError);
      }
    }

    return NextResponse.json({ trends });
  } catch (err) {
    return errorResponse('Trend detection failed.', 500, err);
  }
}
