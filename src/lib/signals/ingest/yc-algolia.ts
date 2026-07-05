import type { IngestedLead } from '@/lib/signals/types';
import { signalsDebugEnabled } from '@/lib/signals/ingest/config';

/**
 * Reliable YC directory ingest via YC's own Algolia search index.
 *
 * The company directory (ycombinator.com/companies) is an Algolia-backed SPA.
 * Rather than have an AI agent read the rendered page (nondeterministic — a run
 * returns 0-10 rows), we query the same Algolia index the page queries: one HTTP
 * call, ~300ms, deterministic, with real company homepages. We read the app id
 * and (secured, read-only) search key from `window.AlgoliaOpts` on the live page
 * each run, so nothing is hardcoded and a key rotation on YC's side is picked up
 * automatically. Founder contacts are NOT in the index (resolved later by the
 * enrichment path), so leads land with founders: [] — same as the agent path.
 */

const YC_COMPANIES_URL = 'https://www.ycombinator.com/companies';
// Recency-sorted index → freshest batches first (what GTM outreach wants).
const YC_ALGOLIA_INDEX = 'YCCompany_By_Launch_Date_production';
const ALGOLIA_OPTS_RE = /AlgoliaOpts\s*=\s*(\{.*?\})/;
const MAX_HITS = 50;

interface AlgoliaOpts {
  app: string;
  key: string;
}

interface YcHit {
  slug?: string;
  name?: string;
  one_liner?: string;
  long_description?: string;
  website?: string;
  batch_name?: string;
  industries?: string[];
  tags?: string[];
}

/** A founder contact scraped from a YC company detail page. */
export interface YcFounder {
  name?: string;
  role?: string;
  linkedinUrl?: string;
  xHandle?: string;
}

const YC_COMPANY_BASE = 'https://www.ycombinator.com/companies/';
const DATA_PAGE_RE = /data-page="([^"]*)"/;

/** Decodes the HTML entities YC uses inside the data-page attribute JSON. */
function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

/** Extracts a bare X/Twitter handle from a profile URL, if present. */
function handleFromTwitter(url: unknown): string | undefined {
  if (!url) return undefined;
  const m = String(url).match(/(?:twitter|x)\.com\/(@?[A-Za-z0-9_]+)/i);
  return m ? m[1].replace(/^@/, '') : undefined;
}

/**
 * Fetches founder contacts (name, role, LinkedIn, X) for a YC company from its
 * detail page. YC embeds the full company record — including founders with
 * linkedin_url — as entity-encoded JSON in the page's `data-page` attribute, so
 * this is one HTTP fetch + parse: reliable and free, unlike an AI-agent read of
 * the rendered SPA. Returns [] on any failure so enrichment degrades gracefully.
 */
export async function fetchYcFounders(slug: string): Promise<YcFounder[]> {
  const clean = slug.trim();
  if (!clean) return [];
  try {
    const res = await fetch(`${YC_COMPANY_BASE}${encodeURIComponent(clean)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return [];
    const html = await res.text();
    const match = html.match(DATA_PAGE_RE);
    if (!match) return [];
    const data = JSON.parse(decodeEntities(match[1])) as {
      props?: { company?: { founders?: Array<Record<string, unknown>> } };
    };
    const founders = data.props?.company?.founders ?? [];
    return founders.map((f) => ({
      name: f.full_name ? String(f.full_name) : undefined,
      role: f.title ? String(f.title) : undefined,
      linkedinUrl: f.linkedin_url ? String(f.linkedin_url) : undefined,
      xHandle: handleFromTwitter(f.twitter_url),
    }));
  } catch (err) {
    if (signalsDebugEnabled()) {
      console.warn(`[yc-detail] ${clean} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return [];
  }
}

/** Reads the live app id + secured search key YC injects into its page. */
async function readAlgoliaOpts(): Promise<AlgoliaOpts> {
  const res = await fetch(YC_COMPANIES_URL, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`YC page returned ${res.status}`);
  const html = await res.text();
  const match = html.match(ALGOLIA_OPTS_RE);
  if (!match) throw new Error('AlgoliaOpts not found on YC page (layout changed)');
  const opts = JSON.parse(match[1]) as AlgoliaOpts;
  if (!opts.app || !opts.key) throw new Error('AlgoliaOpts missing app/key');
  return opts;
}

/** Maps one Algolia hit to a normalized IngestedLead, or null if unusable. */
function mapHit(hit: YcHit): IngestedLead | null {
  const companyName = String(hit.name ?? '').trim();
  const externalId = String(hit.slug ?? companyName).trim();
  if (!companyName || !externalId) return null;
  return {
    source: 'yc_directory',
    externalId,
    companyName,
    tagline: hit.one_liner || hit.long_description || undefined,
    website: hit.website || undefined,
    batch: hit.batch_name || undefined,
    tags: hit.industries ?? hit.tags ?? [],
    founders: [],
  };
}

/**
 * Fetches up to `limit` recent YC companies via Algolia. Throws a plain Error on
 * any failure (page fetch, missing opts, non-200) so the caller wraps it in a
 * DirectoryScrapeError and isolates the source.
 */
export async function fetchYcCompaniesViaAlgolia(limit: number): Promise<IngestedLead[]> {
  const startedAt = Date.now();
  const { app, key } = await readAlgoliaOpts();

  const res = await fetch(`https://${app.toLowerCase()}-dsn.algolia.net/1/indexes/*/queries`, {
    method: 'POST',
    headers: {
      'X-Algolia-Application-Id': app,
      'X-Algolia-API-Key': key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      requests: [
        {
          indexName: YC_ALGOLIA_INDEX,
          params: `query=&hitsPerPage=${Math.min(Math.max(limit, 1), MAX_HITS)}&page=0`,
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Algolia ${res.status}: ${await res.text()}`);

  const json = (await res.json()) as { results?: Array<{ hits?: YcHit[] }> };
  const hits = json.results?.[0]?.hits ?? [];
  const leads = hits.map(mapHit).filter((l): l is IngestedLead => l !== null);

  if (signalsDebugEnabled()) {
    console.log(`[yc-algolia] ${hits.length} hits -> ${leads.length} leads in ${Date.now() - startedAt}ms`);
  }
  return leads;
}
