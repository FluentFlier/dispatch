import { chatCompletion } from '@/lib/llm';
import type { ClassifiedSignal, IngestedPost, SignalSourceRow } from '@/lib/signals/types';

/**
 * Detection for keyword-monitoring sources (source_type = 'keyword_search').
 *
 * Unlike tracked-account sources, the post already matched the user's query at
 * fetch time (the X search did the matching), so there is nothing to classify:
 * the deterministic builder below turns every fetched post into a
 * 'keyword_match' signal. The GTM hybrid classifier is intentionally bypassed —
 * it is tuned for funding/launch/accelerator language and would drop arbitrary
 * topic matches.
 */

/** Drop keyword matches the LLM scores below this ICP-relevance threshold. */
const RELEVANCE_DROP_THRESHOLD = 0.35;

/** Confidence when no relevance gate runs (no ICP, or the LLM call failed). */
const BASELINE_CONFIDENCE = 0.5;

/** The keyword a source monitors, for display: prefer the label, else the raw query. */
export function sourceKeyword(source: Pick<SignalSourceRow, 'label' | 'handle_or_url'>): string {
  return (source.label ?? '').trim() || source.handle_or_url.trim();
}

/** ISO-8601 week stamp (e.g. "2026-W28") — the resurfacing window for dedupe. */
export function isoWeek(date: Date): string {
  // ISO week: Thursday of the current week determines the year/week number.
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * Deterministic keyword-match signal. The dedupe key scopes to
 * keyword + author + ISO week, so a prolific author resurfaces at most once
 * per keyword per week instead of flooding the feed with every post — the
 * existing unique index on (workspace_id, dedupe_key) enforces it.
 */
export function buildKeywordMatchSignal(
  post: IngestedPost,
  source: SignalSourceRow,
): ClassifiedSignal {
  const keyword = sourceKeyword(source);
  const handle = (post.authorHandle ?? '').replace(/^@/, '');
  const snippet = post.content.slice(0, 160).replace(/\s+/g, ' ').trim();
  const week = isoWeek(post.postedAt ? new Date(post.postedAt) : new Date());
  const keywordSlug = keyword.toLowerCase().replace(/\s+/g, '-');

  return {
    signalType: 'keyword_match',
    personName: post.authorName?.trim() || handle || undefined,
    signalSummary: `@${handle} just posted about "${keyword}": ${snippet}`,
    confidence: BASELINE_CONFIDENCE,
    dedupeKey: `keyword_match|${keywordSlug}|${handle.toLowerCase()}|${week}`,
    matchedKeywords: [keyword],
  };
}

const RELEVANCE_SYSTEM = [
  'You score how relevant a social post author is as a potential lead for a business, given the business\'s ideal customer profile (ICP).',
  'Reply ONLY with compact JSON, no prose, no markdown fences.',
  'Schema: {"relevance":0-1,"reason":str}',
  'Score near 0 for spam, engagement bait, or authors clearly outside the ICP; near 1 for authors who look like the ICP talking about a matching problem or activity.',
].join(' ');

/**
 * Optional stage 2: LLM relevance score of a keyword match against the
 * workspace ICP. FAILS OPEN — any provider/parse error returns null and the
 * caller keeps the lead at baseline confidence rather than dropping it (the
 * opposite of the GTM confirm, where junk must never become a lead).
 */
export async function scoreKeywordRelevance(
  post: IngestedPost,
  icpDescription: string,
): Promise<number | null> {
  const user = [
    `ICP: """${icpDescription.slice(0, 800)}"""`,
    `Post by ${post.authorName ?? post.authorHandle ?? 'unknown'}:`,
    `"""${post.content.slice(0, 1200)}"""`,
  ].join('\n');

  let raw: string;
  try {
    raw = await chatCompletion(RELEVANCE_SYSTEM, user, { temperature: 0 });
  } catch {
    return null;
  }

  const cleaned = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try {
    const obj = JSON.parse(cleaned) as { relevance?: unknown };
    const n = Number(obj?.relevance);
    if (Number.isNaN(n)) return null;
    return Math.max(0, Math.min(1, n));
  } catch {
    return null;
  }
}

/**
 * Full keyword-source detection: deterministic match signal, then the optional
 * ICP relevance gate. Returns null only when the gate ran successfully and
 * scored the post below the drop threshold.
 */
export async function classifyKeywordPost(
  post: IngestedPost,
  source: SignalSourceRow,
  opts: { icpDescription?: string | null; skipRelevance?: boolean } = {},
): Promise<ClassifiedSignal | null> {
  const signal = buildKeywordMatchSignal(post, source);

  const icp = opts.icpDescription?.trim();
  if (!icp || opts.skipRelevance) return signal;

  const score = await scoreKeywordRelevance(post, icp);
  if (score === null) return signal; // fail-open: keep at baseline confidence
  if (score < RELEVANCE_DROP_THRESHOLD) return null;
  return { ...signal, confidence: score };
}
