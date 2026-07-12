/**
 * Stage 0 - generation-time web research (ported concept from imagine's
 * tool-augmented content writer, which drafted with live search/scrape tools).
 * One fast-tier call turns the brief into 1-2 search queries, Apify's Google
 * Search scraper returns organic snippets, and the findings become a
 * RESEARCH NOTES section in the generation context. The base stage can then
 * draft with fresh, real specifics instead of vague claims, and
 * fabricated_specifics treats those numbers as sourced rather than invented.
 *
 * Strictly best-effort: any failure, missing key, or timeout returns null and
 * generation proceeds exactly as before. Never throws.
 */

import { chatCompletion } from '@/lib/llm';
import { resolveModel } from '@/lib/ai-tiers';
import { emitPipelineEvent } from './events';

/** Must stay in sync with KNOWN_SECTION_HEADERS in context-split.ts. */
export const RESEARCH_HEADER = 'RESEARCH NOTES';

// Wall-clock cap for the whole stage (query synthesis + search). Research is
// an enrichment, not a dependency - a slow search must not stall generation.
const RESEARCH_TIMEOUT_MS = 25_000;
const MAX_FINDINGS = 6;
const MAX_SNIPPET_CHARS = 240;

const QUERY_SYSTEM = `You turn a social-post brief into web search queries.
Return STRICT JSON: {"queries": ["...", "..."]} with 1-2 queries, each under 12 words.
Target facts the post could cite: statistics, named examples, recent developments.
No hashtags, no quotes around the whole query, no year unless the brief names one.`;

export interface ResearchFinding {
  title: string;
  url: string;
  snippet: string;
}

export function isResearchConfigured(): boolean {
  return Boolean(process.env.APIFY_TOKEN?.trim());
}

async function synthesizeQueries(userPrompt: string): Promise<string[]> {
  try {
    const raw = await chatCompletion(QUERY_SYSTEM, userPrompt.slice(0, 2000), {
      temperature: 0.2,
      maxTokens: 200,
      model: resolveModel('fast'),
    });
    const parsed = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) as {
      queries?: unknown;
    };
    const queries = Array.isArray(parsed.queries)
      ? parsed.queries.filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
      : [];
    if (queries.length > 0) return queries.slice(0, 2).map((q) => q.trim());
  } catch {
    // fall through to the raw-brief fallback
  }
  // Degraded but useful: the brief itself is usually a searchable phrase.
  return [userPrompt.replace(/\s+/g, ' ').trim().slice(0, 90)];
}

interface ApifySearchItem {
  organicResults?: Array<{ title?: string; url?: string; description?: string }>;
}

async function searchGoogle(queries: string[], signal: AbortSignal): Promise<ResearchFinding[]> {
  const token = process.env.APIFY_TOKEN!;
  const res = await fetch(
    `https://api.apify.com/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items?token=${encodeURIComponent(token)}&timeout=20`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        queries: queries.join('\n'),
        resultsPerPage: 5,
        maxPagesPerQuery: 1,
      }),
      signal,
    },
  );
  if (!res.ok) throw new Error(`apify search HTTP ${res.status}`);
  const items = (await res.json()) as ApifySearchItem[];

  const seen = new Set<string>();
  const findings: ResearchFinding[] = [];
  for (const item of Array.isArray(items) ? items : []) {
    for (const r of item.organicResults ?? []) {
      if (!r.title || !r.description) continue;
      const key = r.title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        title: r.title.trim(),
        url: (r.url ?? '').trim(),
        snippet: r.description.replace(/\s+/g, ' ').trim().slice(0, MAX_SNIPPET_CHARS),
      });
      if (findings.length >= MAX_FINDINGS) return findings;
    }
  }
  return findings;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'web';
  }
}

export function formatResearchBlock(findings: ResearchFinding[]): string {
  const lines = findings.map(
    (f, i) => `${i + 1}. ${f.title} (${domainOf(f.url)}): ${f.snippet}`,
  );
  return `${RESEARCH_HEADER} (fresh web findings for this brief - use only what is genuinely relevant, attribute borrowed facts to their source, and never extrapolate numbers beyond what is written here):\n${lines.join('\n')}`;
}

/**
 * Runs the full research stage. Returns the formatted RESEARCH NOTES section
 * or null when research is unconfigured, times out, errors, or finds nothing.
 */
export async function runResearchStage(opts: {
  userPrompt: string;
  requestId: string;
  userId?: string;
}): Promise<string | null> {
  if (!isResearchConfigured()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RESEARCH_TIMEOUT_MS);
  try {
    const queries = await synthesizeQueries(opts.userPrompt);
    const findings = await searchGoogle(queries, controller.signal);
    if (findings.length === 0) {
      await emitPipelineEvent({
        requestId: opts.requestId, userId: opts.userId,
        event: 'research_failed', detail: { reason: 'no_results', queries },
      });
      return null;
    }
    await emitPipelineEvent({
      requestId: opts.requestId, userId: opts.userId,
      event: 'research_complete', detail: { queries, findings: findings.length },
    });
    return formatResearchBlock(findings);
  } catch (err) {
    await emitPipelineEvent({
      requestId: opts.requestId, userId: opts.userId,
      event: 'research_failed',
      detail: { reason: err instanceof Error ? err.message.slice(0, 120) : 'unknown' },
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
