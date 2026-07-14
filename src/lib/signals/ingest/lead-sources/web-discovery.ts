import type { IngestedLead, LeadSource } from '@/lib/signals/types';
import { serperSearch, jinaRead } from '@/lib/event-capture/research';
import { chatCompletion, isLlmConfigured } from '@/lib/llm';
import { normalizeDomain } from '@/lib/signals/leads/identity';
import { signalsDebugEnabled, scrapeTimeoutMs } from '@/lib/signals/ingest/config';
import { isTinyFishConfigured } from '@/lib/signals/ingest/tinyfish-fetch';
import {
  isWebDiscoveryConfigured,
  isSerperWebDiscoveryConfigured,
} from '@/lib/signals/ingest/lead-sources/web-discovery-config';
import { LEAD_OUTPUT_SCHEMA } from '@/lib/signals/ingest/directory-queries';
import type { DiscoveryContext, LeadDiscoveryAdapter } from '@/lib/signals/ingest/lead-sources/types';

const AGENT_ENDPOINT = 'https://agent.tinyfish.ai/v1/automation/run';

const MAX_SERPER_RESULTS = 10;
const MAX_JINA_READS = 4;
const MAX_EXTRACT = 20;

export { isWebDiscoveryConfigured, isSerperWebDiscoveryConfigured } from '@/lib/signals/ingest/lead-sources/web-discovery-config';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function buildSearchQueries(ctx: DiscoveryContext): string[] {
  const out: string[] = [];
  const desc = ctx.icpDescription?.trim();
  if (desc) out.push(desc.slice(0, 220));
  if (ctx.icpQuery.trim()) {
    out.push(`${ctx.icpQuery.trim()} companies list`);
  }
  return Array.from(new Set(out.map((q) => q.trim()).filter(Boolean))).slice(0, 2);
}

/** Skips social profiles and obvious non-company pages. */
function isUsefulResultUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host.includes('linkedin.com') && url.includes('/in/')) return false;
    if (host.includes('twitter.com') || host.includes('x.com')) return false;
    if (host.includes('facebook.com')) return false;
    if (host.includes('instagram.com')) return false;
    if (host.includes('youtube.com')) return false;
    return true;
  } catch {
    return false;
  }
}

interface ExtractedCompany {
  company_name?: string;
  website?: string;
  tagline?: string;
  tags?: string[];
}

const EXTRACT_SYSTEM = [
  'You extract companies or organizations that match an ideal-customer-profile (ICP) from web search results.',
  'Return ONLY valid JSON with this shape:',
  '{"companies":[{"company_name":"...","website":"https://...","tagline":"...","tags":["..."]}]}',
  'Include only real businesses that clearly fit the ICP. No duplicates. No invented names.',
  'If website is unknown, omit it or set null. Max 20 companies.',
].join(' ');

export function parseExtractedCompanies(raw: string): ExtractedCompany[] {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? raw).trim();
  try {
    const parsed = JSON.parse(candidate) as { companies?: unknown };
    if (!Array.isArray(parsed.companies)) return [];
    return parsed.companies as ExtractedCompany[];
  } catch {
    const match = raw.match(/\{[\s\S]*"companies"[\s\S]*\}/);
    if (!match) return [];
    try {
      const parsed = JSON.parse(match[0]) as { companies?: unknown };
      return Array.isArray(parsed.companies) ? (parsed.companies as ExtractedCompany[]) : [];
    } catch {
      return [];
    }
  }
}

export function mapExtractedToLeads(rows: ExtractedCompany[]): IngestedLead[] {
  const seen = new Set<string>();
  const leads: IngestedLead[] = [];

  for (const row of rows) {
    const companyName = String(row.company_name ?? '').trim();
    if (!companyName || companyName.length < 2) continue;
    const website = row.website ? String(row.website).trim() : undefined;
    const domain = website ? normalizeDomain(website) : undefined;
    const dedupeKey = domain ?? slugify(companyName);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    leads.push({
      source: 'web_discovery',
      externalId: `web-${slugify(companyName)}${domain ? `-${domain.replace(/\./g, '-')}` : ''}`,
      companyName,
      tagline: row.tagline ? String(row.tagline).trim() : undefined,
      website,
      tags: Array.isArray(row.tags) ? row.tags.map(String).filter(Boolean).slice(0, 8) : [],
      founders: [],
    });
  }
  return leads;
}

export interface WebDiscoveryDeps {
  search?: typeof serperSearch;
  read?: typeof jinaRead;
  complete?: typeof chatCompletion;
  /** Inject for tests - when set, skips live TinyFish agent calls. */
  tinyfishDiscover?: (ctx: DiscoveryContext) => Promise<IngestedLead[]>;
}

interface AgentRunResponse {
  status?: string;
  result?: Record<string, unknown> | null;
  error?: string | null;
}

/** Maps TinyFish agent `companies` output into web_discovery leads. */
function mapTinyfishCompanies(result: Record<string, unknown>): IngestedLead[] {
  const rows = Array.isArray(result.companies)
    ? (result.companies as Array<Record<string, unknown>>)
    : [];
  const extracted: ExtractedCompany[] = rows.map((r) => ({
    company_name: r.company_name ? String(r.company_name) : undefined,
    website: r.website ? String(r.website) : undefined,
    tagline: r.tagline ? String(r.tagline) : undefined,
    tags: Array.isArray(r.tags) ? (r.tags as unknown[]).map(String) : [],
  }));
  return mapExtractedToLeads(extracted);
}

/**
 * Primary scraper: the TinyFish agent reads a Google results page for the ICP
 * query and extracts matching companies. TinyFish drives a real browser, so it
 * handles Google's JS/anti-scrape better than a raw fetch would; Serper is the
 * fallback in discoverWebLeads when this returns nothing or errors.
 */
export async function discoverWebLeadsViaTinyfish(ctx: DiscoveryContext): Promise<IngestedLead[]> {
  if (!isTinyFishConfigured() || !isLlmConfigured()) return [];
  const query = buildSearchQueries(ctx)[0];
  if (!query) return [];

  const url = `https://www.google.com/search?q=${encodeURIComponent(`${query} companies`)}`;
  const goal =
    `From these search results, extract up to ${Math.min(ctx.maxLeads, MAX_EXTRACT)} real ` +
    `companies or organizations that match this ICP: "${query}". For each return ` +
    `company_name, website (if visible), tagline, tags. Skip ads and generic listicles. ` +
    `Return JSON.`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), scrapeTimeoutMs());
  try {
    const res = await fetch(AGENT_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': process.env.TINYFISH_API_KEY!.trim(),
      },
      body: JSON.stringify({ url, goal, output_schema: LEAD_OUTPUT_SCHEMA }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`TinyFish ${res.status}: ${await res.text()}`);
    const payload = (await res.json()) as AgentRunResponse;
    if (payload.status !== 'COMPLETED' || payload.error) {
      throw new Error(`TinyFish run ${payload.status ?? 'unknown'}: ${payload.error ?? 'no result'}`);
    }
    return mapTinyfishCompanies(payload.result ?? {}).slice(0, Math.min(ctx.maxLeads, MAX_EXTRACT));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Web lead discovery. TinyFish is the MAIN scraper (agent on Google); Serper is
 * the FALLBACK, used only when TinyFish is unavailable, errors, or finds nothing.
 */
export async function discoverWebLeads(
  ctx: DiscoveryContext,
  deps: WebDiscoveryDeps = {},
): Promise<IngestedLead[]> {
  if (!isWebDiscoveryConfigured()) return [];

  // Primary: TinyFish.
  if (isTinyFishConfigured()) {
    const tinyfish = deps.tinyfishDiscover ?? discoverWebLeadsViaTinyfish;
    try {
      const leads = await tinyfish(ctx);
      if (leads.length > 0) return leads;
      if (signalsDebugEnabled()) {
        console.log('[web-discovery] TinyFish returned 0 leads, falling back to Serper');
      }
    } catch (err) {
      console.warn(
        `[web-discovery] TinyFish failed, falling back to Serper: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Fallback: Serper (Google search API) → page text (Jina) → LLM extract.
  if (!isSerperWebDiscoveryConfigured()) return [];
  return discoverWebLeadsViaSerper(ctx, deps);
}

/** Fallback path: ICP → Serper (Google) → page text (Jina) → LLM structured extract. */
async function discoverWebLeadsViaSerper(
  ctx: DiscoveryContext,
  deps: WebDiscoveryDeps = {},
): Promise<IngestedLead[]> {
  const debug = signalsDebugEnabled();
  const search = deps.search ?? serperSearch;
  const read = deps.read ?? jinaRead;
  const complete = deps.complete ?? chatCompletion;

  const queries = buildSearchQueries(ctx);
  if (queries.length === 0) return [];

  const serpBlocks: string[] = [];
  const readUrls: string[] = [];

  for (const query of queries) {
    const results = await search(query, MAX_SERPER_RESULTS);
    for (const r of results) {
      serpBlocks.push(
        `Title: ${r.title ?? ''}\nURL: ${r.link}\nSnippet: ${r.snippet ?? ''}`,
      );
      if (isUsefulResultUrl(r.link) && !readUrls.includes(r.link)) {
        readUrls.push(r.link);
      }
    }
  }

  if (serpBlocks.length === 0) return [];

  const pageTexts: string[] = [];
  for (const url of readUrls.slice(0, MAX_JINA_READS)) {
    const text = await read(url);
    if (text) pageTexts.push(`--- Page: ${url} ---\n${text.slice(0, 6000)}`);
  }

  const icpBlock =
    `ICP: ${ctx.icpDescription?.trim() || ctx.icpQuery}\n` +
    `Verticals: ${ctx.icpVerticals.join(', ') || 'n/a'}\n` +
    `Keywords: ${ctx.icpKeywords.join(', ') || 'n/a'}`;

  const userPrompt = [
    icpBlock,
    '',
    'Search results:',
    serpBlocks.join('\n\n'),
    pageTexts.length > 0 ? '\nPage content:\n' + pageTexts.join('\n\n') : '',
  ].join('\n');

  let raw: string;
  try {
    raw = await complete(EXTRACT_SYSTEM, userPrompt, { temperature: 0.1, maxTokens: 2000 });
  } catch (err) {
    if (debug) {
      console.warn(
        `[web-discovery] LLM extract failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    return [];
  }

  const extracted = parseExtractedCompanies(raw);
  const leads = mapExtractedToLeads(extracted).slice(0, Math.min(ctx.maxLeads, MAX_EXTRACT));
  if (debug) console.log(`[web-discovery] queries=${queries.length} leads=${leads.length}`);
  return leads;
}

export const webDiscoveryAdapter: LeadDiscoveryAdapter = {
  source: 'web_discovery',
  label: 'Web discovery',
  category: 'icp',
  isAvailable: isWebDiscoveryConfigured,
  discover: discoverWebLeads,
};
