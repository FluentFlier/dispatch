/**
 * Trend detection core, shared by the user-triggered route (/api/trends/detect)
 * and the daily active-users cron (/api/cron/trends-refresh).
 *
 * Grounded extraction: the model only summarizes trends that ACTUALLY appear in
 * scraped recent posts. A bare LLM has no live data and hallucinates stale
 * launches as "trending now"; feeding it real recent posts is the only honest
 * way to detect what people are posting about today.
 *
 * Trends are written per (user_id, workspace_id) so a creator's automotive
 * client workspace never bleeds trends into their founder workspace.
 */
import type { createClient } from '@insforge/sdk';
import { generateContent } from '@/lib/ai';
import { fetchRecentPostsByKeywords, type RawPost } from '@/lib/hooks-intelligence/mining';

type InsforgeClient = ReturnType<typeof createClient>;

const TREND_EXTRACT_PROMPT = `You are a social media trend analyst. You are given REAL recent posts scraped from LinkedIn/X for a creator's topics. Identify the genuine trends, recurring themes, and angles that ACTUALLY appear in these posts.

STRICT RULES:
- Only report topics that genuinely appear in the provided posts. NEVER invent product launches, news, dates, or events that are not present in the posts.
- Base "why_trending" on evidence from the posts (recurring themes, high engagement), not outside knowledge.
- If the posts support fewer than 5 real trends, return fewer. Quality over count.
- Do not use em dashes or en dashes anywhere.

For each trend provide: topic, why_trending, angle (a specific angle the creator could take), best_platform (twitter|linkedin|instagram|threads), urgency (immediate|today|this_week), draft_hook (first line of a post), confidence (0.0-1.0).

Return a JSON array only:
[{"topic":"...","why_trending":"...","angle":"...","best_platform":"linkedin","urgency":"this_week","draft_hook":"...","confidence":0.0}]`;

export interface DetectTrendsResult {
  ok: boolean;
  /** HTTP-ish status the route can pass straight through. */
  status: number;
  trends?: unknown[];
  error?: string;
  message?: string;
}

/** Build search keywords from the creator's pillars + matching global niche seed keywords. */
async function resolveSearchTerms(
  client: InsforgeClient,
  userId: string,
): Promise<{ pillarNames: string[]; searchTerms: string[] }> {
  let pillarNames: string[] = [];
  try {
    const { data: profileRow } = await client.database
      .from('creator_profile')
      .select('content_pillars')
      .eq('user_id', userId)
      .single();
    const raw = (profileRow as { content_pillars?: unknown } | null)?.content_pillars;
    const pillars = typeof raw === 'string' ? JSON.parse(raw) : raw;
    pillarNames = (Array.isArray(pillars) ? pillars : [])
      .map((p: { name?: string }) => (p?.name ?? '').trim())
      .filter(Boolean);
  } catch {
    // No profile / unparseable pillars - caller handles the empty-terms case.
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
  return { pillarNames, searchTerms: Array.from(keywords).slice(0, 12) };
}

/**
 * Detect and persist trends for one user + workspace. Pure of auth/guard concerns
 * so both the interactive route (which adds session auth + AI budget guard) and
 * the cron (which does its own per-run capping) can call it.
 */
export async function detectTrendsForUser(
  client: InsforgeClient,
  userId: string,
  workspaceId: string | null,
): Promise<DetectTrendsResult> {
  // Live trends require the scraper. "Disable and say so" rather than fabricate.
  if (!process.env.APIFY_TOKEN) {
    return { ok: false, status: 400, error: 'Live trend detection needs the scraper configured (set APIFY_TOKEN).' };
  }

  const { pillarNames, searchTerms } = await resolveSearchTerms(client, userId);
  if (searchTerms.length === 0) {
    return { ok: false, status: 400, error: 'Add content pillars first so trends can be detected for your topics.' };
  }

  let posts: RawPost[];
  try {
    posts = await fetchRecentPostsByKeywords(searchTerms, 40);
  } catch (err) {
    return { ok: false, status: 502, error: 'Could not scrape recent posts for trend detection.', message: String(err) };
  }
  posts = posts.filter((p) => p.text && p.text.length > 40);
  if (posts.length === 0) {
    return { ok: true, status: 200, trends: [], message: 'No recent posts found for your topics yet.' };
  }

  const digest = [...posts]
    .sort((a, b) => b.likes + b.comments - (a.likes + a.comments))
    .slice(0, 30)
    .map((p, i) => `${i + 1}. [${p.likes}L/${p.comments}C] ${p.text.replace(/\s+/g, ' ').slice(0, 300)}`)
    .join('\n');

  const prompt = `Creator's topics: ${pillarNames.join(', ') || 'general'}.
Below are ${posts.length} real recent posts scraped for these topics. Identify the genuine trends and angles ACTUALLY present in them. Do not invent anything not in these posts.

POSTS:
${digest}`;

  let trends: unknown[];
  try {
    const result = await generateContent(prompt, undefined, TREND_EXTRACT_PROMPT);
    const jsonMatch = result.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return { ok: false, status: 500, error: 'Failed to parse trends' };
    trends = JSON.parse(jsonMatch[0]);
  } catch (err) {
    return { ok: false, status: 500, error: 'Trend detection failed.', message: String(err) };
  }

  // Upsert dedups on (user_id, workspace_id, topic); surface a write failure
  // instead of returning trends the dashboard will never see.
  const detectedAt = new Date().toISOString();
  for (const t of trends as Array<Record<string, unknown>>) {
    const { error: upsertError } = await client.database.from('detected_trends').upsert({
      user_id: userId,
      workspace_id: workspaceId,
      topic: t.topic,
      why_trending: t.why_trending,
      angle: t.angle,
      best_platform: t.best_platform,
      urgency: t.urgency,
      draft_hook: t.draft_hook,
      confidence: t.confidence,
      detected_at: detectedAt,
    }, { onConflict: 'user_id,workspace_id,topic' });
    if (upsertError) {
      return { ok: false, status: 500, error: 'Failed to save detected trends.', message: String(upsertError) };
    }
  }

  return { ok: true, status: 200, trends };
}
