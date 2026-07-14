import type { IngestedLead } from '@/lib/signals/types';
import { serperSearch, jinaRead } from '@/lib/event-capture/research';
import { chatCompletion, isLlmConfigured } from '@/lib/llm';
import { signalsDebugEnabled } from '@/lib/signals/ingest/config';
import { isTinyFishConfigured } from '@/lib/signals/ingest/tinyfish-fetch';
import { tinyfishSearch, tinyfishFetch } from '@/lib/signals/ingest/tinyfish-web';
import { extractCompanyLeads, MAX_PAGE_CHARS } from '@/lib/signals/ingest/extract-companies';
import {
  isWebDiscoveryConfigured,
  isSerperWebDiscoveryConfigured,
} from '@/lib/signals/ingest/lead-sources/web-discovery-config';
import type { DiscoveryContext, LeadDiscoveryAdapter } from '@/lib/signals/ingest/lead-sources/types';

const MAX_SERPER_RESULTS = 10;
const MAX_JINA_READS = 4;

export { isWebDiscoveryConfigured, isSerperWebDiscoveryConfigured } from '@/lib/signals/ingest/lead-sources/web-discovery-config';
// Re-exported for tests + directory callers (extraction now lives in one module).
export {
  mapExtractedToLeads,
  parseExtractedCompanies,
  extractCompanyLeads,
} from '@/lib/signals/ingest/extract-companies';

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

export interface WebDiscoveryDeps {
  search?: typeof serperSearch;
  read?: typeof jinaRead;
  complete?: typeof chatCompletion;
  /** Inject for tests - when set, skips live TinyFish agent calls. */
  tinyfishDiscover?: (ctx: DiscoveryContext) => Promise<IngestedLead[]>;
}

/**
 * Primary scraper: TinyFish Search (ranked JSON for the ICP query) → TinyFish
 * Fetch (clean text of the top result pages) → LLM extract. This replaces the old
 * Agent-reads-google.com path, which drove a real browser through a Google results
 * page and routinely timed out (~200s) on the render. Search+Fetch return in ~2s
 * with no CAPTCHA. Serper is the fallback in discoverWebLeads when this yields
 * nothing or errors.
 */
export async function discoverWebLeadsViaTinyfish(ctx: DiscoveryContext): Promise<IngestedLead[]> {
  if (!isTinyFishConfigured() || !isLlmConfigured()) return [];
  const query = buildSearchQueries(ctx)[0];
  if (!query) return [];

  const results = await tinyfishSearch(`${query} companies`, MAX_SERPER_RESULTS);
  if (results.length === 0) return [];

  const serp = results
    .map((r) => `Title: ${r.title ?? ''}\nURL: ${r.url}\nSnippet: ${r.snippet ?? ''}`)
    .join('\n\n');

  // Read the top company-looking pages for substance beyond the snippets.
  const readUrls = results.map((r) => r.url).filter(isUsefulResultUrl).slice(0, MAX_JINA_READS);
  let pages = '';
  try {
    const fetched = await tinyfishFetch(readUrls);
    pages = fetched.map((p) => `--- Page: ${p.url} ---\n${p.text.slice(0, MAX_PAGE_CHARS)}`).join('\n\n');
  } catch (err) {
    // Snippets alone are still enough to extract from - a Fetch failure isn't fatal.
    if (signalsDebugEnabled()) {
      console.warn(`[web-discovery] TinyFish Fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return extractCompanyLeads(ctx, 'web_discovery', { serp, pages });
}

/**
 * Web lead discovery. TinyFish Search+Fetch is the MAIN scraper; Serper is the
 * FALLBACK, used only when TinyFish is unavailable, errors, or finds nothing.
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
    if (text) pageTexts.push(`--- Page: ${url} ---\n${text.slice(0, MAX_PAGE_CHARS)}`);
  }

  const leads = await extractCompanyLeads(
    ctx,
    'web_discovery',
    { serp: serpBlocks.join('\n\n'), pages: pageTexts.join('\n\n') },
    { complete },
  );
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
