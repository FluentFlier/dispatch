import type { IngestedLead } from '@/lib/signals/types';
import { signalsDebugEnabled } from '@/lib/signals/ingest/config';
import { normalizeName } from '@/lib/signals/leads/identity';

/**
 * Reliable YC directory ingest via YC's own Algolia search index.
 *
 * The company directory (ycombinator.com/companies) is an Algolia-backed SPA.
 * Rather than have an AI agent read the rendered page (nondeterministic - a run
 * returns 0-10 rows), we query the same Algolia index the page queries: one HTTP
 * call, ~300ms, deterministic, with real company homepages. We read the app id
 * and (secured, read-only) search key from `window.AlgoliaOpts` on the live page
 * each run, so nothing is hardcoded and a key rotation on YC's side is picked up
 * automatically. Founder contacts are NOT in the index (resolved later by the
 * enrichment path), so leads land with founders: [] - same as the agent path.
 */

const YC_COMPANIES_URL = 'https://www.ycombinator.com/companies';
// Recency-sorted index → freshest batches first (what GTM outreach wants).
const YC_ALGOLIA_INDEX = 'YCCompany_By_Launch_Date_production';
// Relevance-ranked index - REQUIRED for any text/ICP query. The recency index
// above has a `distinct` setting that collapses a non-empty query to a SINGLE hit
// (nbHits in the thousands, one returned), so an ICP scrape resolved to 1 company
// - usually a filtered mega-corp - and threw "Algolia returned 0 companies". A
// text query on this index returns full pages; empty/recency queries keep the
// launch-date index so fresh batches still rank first.
const YC_ALGOLIA_INDEX_RELEVANCE = 'YCCompany_production';
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

/** Decodes the HTML entities YC uses to encode the data-page attribute JSON. */
function decodeEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

/**
 * Decodes HTML entities inside a TEXT VALUE (one_liner, long_description, names).
 * YC's content is itself HTML-encoded (e.g. "We&#x27;re"), so after JSON.parse
 * the visible text still holds entities - this second pass renders them plainly.
 * Handles named + numeric (decimal and hex) entities; &amp; is decoded last so
 * sequences like "&amp;#x27;" resolve fully.
 */
function decodeText(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v);
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Extracts a bare X/Twitter handle from a profile URL, if present. */
function handleFromTwitter(url: unknown): string | undefined {
  if (!url) return undefined;
  const m = String(url).match(/(?:twitter|x)\.com\/(@?[A-Za-z0-9_]+)/i);
  return m ? m[1].replace(/^@/, '') : undefined;
}

/** Rich company facts for the lead card, parsed from the YC detail page. */
export interface YcCompanyDetail {
  name?: string;
  slug: string;
  oneLiner?: string;
  description?: string;
  website?: string;
  ycUrl: string;
  logoUrl?: string;
  batch?: string;
  teamSize?: number;
  location?: string;
  yearFounded?: number;
  status?: string;
  primaryPartner?: { name: string; url?: string };
  linkedinUrl?: string;
  twitterUrl?: string;
  industries: string[];
  photos: string[];
  founders: YcFounder[];
}

/**
 * Resolves a founder's real title. YC's structured `title` field is frequently
 * just "Founder" for every co-founder, while the actual CEO/CTO/COO designation
 * lives in the free-text `founder_bio` ("Founder & CEO at Acme (YC S26). …").
 * Prefer the bio's leading role phrase when it names a specific C-level/president
 * role the bare title omits; otherwise keep the structured title. This is what
 * lets outreach target the CEO instead of whichever co-founder was listed first.
 */
function extractRole(title: unknown, bio: unknown): string | undefined {
  const structured = decodeText(title) || undefined;
  const b = decodeText(bio) ?? '';

  // Tier 1: a title-anchored lead phrase - "Founder & CEO of Bylaw…",
  // "Co-founder and CEO @ Acme…", "Cofounder & CTO of Poth…". Must START with a
  // role word (so a narrative "Marinos is the co-founder of…" is not mistaken for
  // a title) and must name a C-level role.
  const lead = b
    .match(/^\s*((?:co-?founders?|founder|ceo|cto|coo|cfo|president|chief)[A-Za-z/&,.\-\s]*?)\s+(?:at|of|@)\s/i)?.[1]
    ?.trim()
    .replace(/\s+/g, ' ');
  if (lead && /\b(ceo|cto|coo|cfo|president)\b/i.test(lead)) return lead;

  // Tier 2: bio asserts CEO in prose ("Rohan is the CEO of Praxis…", "serves as
  // CEO"). Only a real role-assertion counts - an incidental mention like "a F500
  // CEO's office" or naming a co-founder's CTO role must NOT tag this person CEO.
  // Restricted to CEO because that's the decision-maker we route outreach to.
  const assertsCeo = /\b(?:is\s+(?:the\s+)?|the\s+|as\s+|serves?\s+as\s+(?:the\s+)?)ceo\b/i.test(b);
  if (assertsCeo) {
    if (structured && !/\bceo\b/i.test(structured)) return `${structured} & CEO`;
    return structured || 'CEO';
  }

  return structured;
}

/** Maps YC founder records to our contact shape. */
function mapFounders(raw: unknown): YcFounder[] {
  const arr = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
  return arr.map((f) => ({
    name: decodeText(f.full_name),
    role: extractRole(f.title, f.founder_bio),
    linkedinUrl: f.linkedin_url ? String(f.linkedin_url) : undefined,
    xHandle: handleFromTwitter(f.twitter_url),
  }));
}

/**
 * Fetches + parses a YC company detail page once. YC embeds the full company
 * record (facts + founders with linkedin_url) as entity-encoded JSON in the
 * page's `data-page` attribute, so this is one HTTP fetch + parse - reliable and
 * free, unlike an AI-agent read of the rendered SPA. Returns null on any failure.
 */
async function fetchYcCompanyRaw(slug: string): Promise<Record<string, unknown> | null> {
  const clean = slug.trim();
  if (!clean) return null;
  try {
    const res = await fetch(`${YC_COMPANY_BASE}${encodeURIComponent(clean)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const match = html.match(DATA_PAGE_RE);
    if (!match) return null;
    const data = JSON.parse(decodeEntities(match[1])) as {
      props?: { company?: Record<string, unknown> };
    };
    return data.props?.company ?? null;
  } catch (err) {
    if (signalsDebugEnabled()) {
      console.warn(`[yc-detail] ${clean} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
  }
}

/** Founder contacts (name, role, LinkedIn, X) for a YC company. [] on failure. */
export async function fetchYcFounders(slug: string): Promise<YcFounder[]> {
  const company = await fetchYcCompanyRaw(slug);
  return company ? mapFounders(company.founders) : [];
}

/** Full company facts + founders for the lead card. null on failure. */
export async function fetchYcCompanyDetail(slug: string): Promise<YcCompanyDetail | null> {
  const clean = slug.trim();
  if (!clean) return null;
  const c = await fetchYcCompanyRaw(clean);
  if (!c) return null;
  // NOTE: the DETAIL page uses different field names than the Algolia index -
  // small_logo_url (not *_thumb_url), tags (not industries), location/city/country
  // (not all_locations), ycdc_status (not status/stage).
  const industries = Array.isArray(c.tags) ? (c.tags as unknown[]).map(String) : [];
  const location =
    (c.location ? String(c.location) : '') ||
    [c.city, c.country].filter(Boolean).map(String).join(', ') ||
    undefined;
  const photos = Array.isArray(c.company_photos)
    ? (c.company_photos as Array<{ url?: unknown }>).map((p) => (p?.url ? String(p.url) : '')).filter(Boolean)
    : [];
  const partner = c.primary_group_partner as { full_name?: unknown; url?: unknown } | undefined;
  const primaryPartner = partner?.full_name
    ? { name: decodeText(partner.full_name) ?? String(partner.full_name), url: partner.url ? String(partner.url) : undefined }
    : undefined;
  return {
    name: decodeText(c.name),
    slug: clean,
    oneLiner: decodeText(c.one_liner),
    description: decodeText(c.long_description),
    website: c.website ? String(c.website) : undefined,
    ycUrl: `${YC_COMPANY_BASE}${encodeURIComponent(clean)}`,
    logoUrl: c.small_logo_url ? String(c.small_logo_url) : c.logo_url ? String(c.logo_url) : undefined,
    batch: c.batch_name ? String(c.batch_name) : c.batch ? String(c.batch) : undefined,
    teamSize: typeof c.team_size === 'number' ? c.team_size : undefined,
    location: decodeText(location),
    yearFounded: typeof c.year_founded === 'number' ? c.year_founded : undefined,
    status: c.ycdc_status ? String(c.ycdc_status) : undefined,
    primaryPartner,
    linkedinUrl: c.linkedin_url ? String(c.linkedin_url) : undefined,
    twitterUrl: c.twitter_url ? String(c.twitter_url) : undefined,
    industries,
    photos,
    founders: mapFounders(c.founders),
  };
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

/**
 * Well-known YC alumni that are now large public/late-stage companies - never
 * real cold-outreach prospects. They can surface via a stray query or a stale
 * index row (e.g. Airbnb, W09) and just pollute the feed, so drop them at ingest.
 * Matched on the stable slug (lowercased).
 */
const MEGACORP_SLUGS = new Set([
  'airbnb', 'stripe', 'coinbase', 'doordash', 'dropbox', 'instacart', 'reddit',
  'twitch', 'gitlab', 'cruise', 'rippling', 'brex', 'deel', 'razorpay', 'zapier',
  'flexport', 'faire', 'scale-ai', 'benchling', 'gusto', 'checkr', 'podium',
  'amplitude', 'mixpanel', 'segment', 'pagerduty', 'weebly', 'quora',
]);

/** Maps one Algolia hit to a normalized IngestedLead, or null if unusable. */
export function mapHit(hit: YcHit): IngestedLead | null {
  const companyName = String(hit.name ?? '').trim();
  const externalId = String(hit.slug ?? companyName).trim();
  if (!companyName || !externalId) return null;
  // Skip junk names (a stopword/fragment is not a real company) and mega-corps.
  if (companyName.length < 2 || !/[a-z0-9]/i.test(companyName)) return null;
  if (MEGACORP_SLUGS.has(externalId.toLowerCase())) return null;
  return {
    source: 'yc_directory',
    externalId,
    companyName,
    tagline: hit.one_liner || hit.long_description || undefined,
    // Keep the long description + industries so the draft prompt has real
    // substance without a re-scrape (previously both were discarded here).
    longDescription: hit.long_description || undefined,
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
export async function fetchYcCompaniesViaAlgolia(limit: number, query = ''): Promise<IngestedLead[]> {
  const startedAt = Date.now();
  const { app, key } = await readAlgoliaOpts();
  const trimmed = query.trim();
  const q = encodeURIComponent(trimmed);

  // ICP-derived queries concatenate many verticals + keywords (e.g. "fintech
  // treasury seed round B2B SaaS ..."). Algolia requires ALL query words to
  // match by default, so a rich multi-term ICP matched ZERO companies (the
  // better a user described their ICP, the emptier the scrape). Marking every
  // word optional keeps ranking - records matching more terms rank higher -
  // while never filtering the result set to nothing. Bare/empty queries are
  // unaffected (no optional words to send).
  const words = trimmed.split(/\s+/).filter(Boolean);
  const optionalWords = words.length > 1 ? `&optionalWords=${encodeURIComponent(JSON.stringify(words))}` : '';
  // Text/ICP query -> relevance index (recency index collapses text queries to 1
  // hit); empty query -> recency index so fresh batches rank first.
  const indexName = trimmed ? YC_ALGOLIA_INDEX_RELEVANCE : YC_ALGOLIA_INDEX;

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
          indexName,
          params: `query=${q}${optionalWords}&hitsPerPage=${Math.min(Math.max(limit, 1), MAX_HITS)}&page=0`,
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Algolia ${res.status}: ${await res.text()}`);

  const json = (await res.json()) as { results?: Array<{ hits?: YcHit[] }> };
  const hits = json.results?.[0]?.hits ?? [];
  const leads = hits.map(mapHit).filter((l): l is IngestedLead => l !== null);

  if (signalsDebugEnabled()) {
    console.log(
      `[yc-algolia] query="${query || '*'}" ${hits.length} hits -> ${leads.length} leads in ${Date.now() - startedAt}ms`,
    );
  }
  return leads;
}

/** A company's real YC identity resolved from its display name. */
export interface YcNameMatch {
  slug: string;
  name: string;
  website?: string;
  batch?: string;
}

/**
 * Resolves a company NAME to its real YC identity via the same Algolia index the
 * directory uses. Returns the top hit ONLY when its normalized name exactly matches
 * the query - a strict gate so a generic name ("Clicks") cannot false-match a
 * different YC company. Used to recover manual/ICP leads that are really YC
 * companies but were stored with a guessed slug. Returns null on no confident match;
 * throws (like the sibling scrape fn) when Algolia itself is unreachable.
 */
export async function findYcCompanyByName(name: string): Promise<YcNameMatch | null> {
  const clean = name.trim();
  if (!clean) return null;
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
          // Name lookup is a text query - use the relevance index (the recency
          // index collapses text queries and can return the wrong single hit).
          indexName: YC_ALGOLIA_INDEX_RELEVANCE,
          params: `query=${encodeURIComponent(clean)}&hitsPerPage=1&page=0`,
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Algolia ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { results?: Array<{ hits?: YcHit[] }> };
  const hit = json.results?.[0]?.hits?.[0];
  if (!hit?.slug || !hit?.name) return null;
  // Strict confidence gate: normalized names must be equal (no fuzzy match).
  if (normalizeName(String(hit.name)) !== normalizeName(clean)) return null;
  return {
    slug: String(hit.slug),
    name: String(hit.name),
    website: hit.website || undefined,
    batch: hit.batch_name || undefined,
  };
}
