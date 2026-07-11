import type { createClient } from '@insforge/sdk';
import { ApifyClient } from 'apify-client';
import type { SignalLeadWithContacts } from '@/lib/signals/types';
import { signalsDebugEnabled } from '@/lib/signals/ingest/config';
import { fetchYcFounders, findYcCompanyByName } from '@/lib/signals/ingest/yc-algolia';
import type { YcFounder, YcNameMatch } from '@/lib/signals/ingest/yc-algolia';
import { chatCompletion } from '@/lib/llm';
import { getWorkspaceLinkedInAccountId, searchLinkedInPerson } from '@/lib/signals/outreach/unipile-linkedin';

type InsforgeClient = ReturnType<typeof createClient>;

/**
 * Founder-contact enrichment for leads the directory didn't hand a social URL.
 * Order (per product decision): for YC leads the company's YC detail page first
 * (reliable, free — it lists founders with LinkedIn), then TinyFish agent on the
 * company site, then Apify (paid). All are best-effort — any failure returns
 * null so the lead simply stays no_contact.
 */

// TinyFish Agent surface — same unified key as directory scraping. The retired
// AgentQL endpoint (api.agentql.com) needs a separate key and 401s with ours.
const AGENT_ENDPOINT = 'https://agent.tinyfish.ai/v1/automation/run';

/** Founder-lookup structured-output contract for the enrichment agent run. */
const FOUNDER_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    founders: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          role: { type: 'string' },
          linkedin_url: { type: 'string' },
        },
      },
    },
  },
} as const;

export interface EnrichedContact {
  name?: string;
  role?: string;
  linkedinUrl?: string;
  via: 'yc_detail' | 'tinyfish' | 'apify' | 'unipile' | 'web_search';
}

/**
 * Runs the enrichment ladder; returns the first founder contact found, or null.
 * `fastOnly` (used by the batch scrape) runs ONLY the fast YC-detail step and
 * skips the slow TinyFish agent + Apify + Unipile search, so auto-resolving
 * every scraped lead inline stays within the request timeout. On-demand "Try
 * to resolve" runs the full ladder.
 *
 * `client`/`workspaceId` are optional because some callers (e.g. tests, or a
 * future context with no workspace) may not have them; when absent, rung 4
 * (Unipile search) has no account_id to search from and is skipped, exactly
 * as it degrades when no LinkedIn account is connected.
 */
export async function enrichFounderContact(
  lead: Pick<SignalLeadWithContacts, 'source' | 'external_id' | 'company_name' | 'website' | 'contacts'>,
  opts: { fastOnly?: boolean; client?: InsforgeClient; workspaceId?: string } = {},
): Promise<EnrichedContact | null> {
  // YC leads: the YC company detail page reliably lists founders + LinkedIn (fast).
  const viaYc = await enrichViaYcDetail(lead);
  if (viaYc) return viaYc;
  // Manual/ICP leads that are really YC companies: recover the real slug by name
  // (Algolia) and pull the founder from the YC detail page. Free (no paid API), so
  // it runs even in the fastOnly batch path — the whole point is auto-resolving the
  // ICP-finder leads that land as source:'manual' without founder data.
  const viaRecovery = await enrichViaYcRecovery(lead);
  if (viaRecovery) return viaRecovery;
  if (opts.fastOnly) return null;
  // Universal rung: LLM web search works for ANY company (non-YC website / X /
  // non-YC ICP leads), so it runs first among the paid rungs. Its result is always
  // verified downstream (resolveLeadContacts runs verifyContactLinkedIn on the
  // on-demand path), so a hallucinated URL is caught before it reaches outreach.
  const viaWeb = await enrichViaWebSearch(lead);
  if (viaWeb) return viaWeb;
  const viaTinyfish = await enrichViaTinyFish(lead);
  if (viaTinyfish) return viaTinyfish;
  const viaApify = await enrichViaApify(lead);
  if (viaApify) return viaApify;

  // Rung 4: a lead may already have a founder name (scraped from the directory
  // or a prior partial enrichment) without a LinkedIn URL. Unipile name-search
  // is the last, deterministic attempt to turn that name into a reachable URL
  // before the lead is marked no_contact.
  const founderName = lead.contacts?.find((c) => c.name)?.name ?? undefined;
  const accountId =
    opts.client && opts.workspaceId
      ? await getWorkspaceLinkedInAccountId(opts.client, opts.workspaceId)
      : null;
  return enrichViaUnipileSearch({ companyName: lead.company_name, founderName, accountId });
}

/**
 * Picks the best founder contact from a YC founder list: prefer the CEO (some list
 * "Founder & CEO", others just "CEO"), then any founder, then the first with a URL.
 * A company where the CEO co-founder differs from the first-listed founder must
 * resolve to the CEO — outreach goes to the decision-maker. null when none has a
 * LinkedIn URL to send a connect to.
 */
function pickFounderContact(founders: YcFounder[]): EnrichedContact | null {
  const withUrl = founders.filter((f) => f.linkedinUrl);
  const found =
    withUrl.find((f) => /\bceo\b/i.test(f.role ?? '')) ??
    withUrl.find((f) => /founder/i.test(f.role ?? '')) ??
    withUrl[0] ??
    founders[0];
  if (!found?.linkedinUrl) return null;
  return { name: found.name, role: found.role, linkedinUrl: found.linkedinUrl, via: 'yc_detail' };
}

/** YC detail page: founder + LinkedIn from the company's /companies/<slug> page. */
async function enrichViaYcDetail(
  lead: Pick<SignalLeadWithContacts, 'source' | 'external_id'>,
): Promise<EnrichedContact | null> {
  if (lead.source !== 'yc_directory' || !lead.external_id) return null;
  return pickFounderContact(await fetchYcFounders(lead.external_id));
}

/** Injectable YC lookups so recovery is unit-testable without hitting YC/Algolia. */
export type YcLookupFn = (name: string) => Promise<YcNameMatch | null>;
export type YcFoundersFn = (slug: string) => Promise<YcFounder[]>;

/**
 * YC-identity recovery for manual/ICP leads. The ICP finder stores real YC
 * companies as source:'manual' with a guessed slug and no founders, so the direct
 * YC-detail rung (which keys on a real slug) skips them. Here we resolve the real
 * YC slug FROM THE COMPANY NAME via Algolia (strict name-match gate), then pull the
 * founder LinkedIn off the YC detail page — the same free path yc_directory leads
 * use. Leads that already carry a real slug (source yc_directory) are handled by
 * enrichViaYcDetail and skipped here. Best-effort: any failure returns null so the
 * ladder falls through to the paid rungs.
 */
export async function enrichViaYcRecovery(
  lead: Pick<SignalLeadWithContacts, 'source' | 'company_name'>,
  deps: { lookup?: YcLookupFn; fetchFounders?: YcFoundersFn } = {},
): Promise<EnrichedContact | null> {
  if (lead.source === 'yc_directory') return null;
  const company = lead.company_name?.trim();
  if (!company) return null;
  const lookup = deps.lookup ?? findYcCompanyByName;
  const fetchFounders = deps.fetchFounders ?? fetchYcFounders;
  let match: YcNameMatch | null;
  try {
    match = await lookup(company);
  } catch (err) {
    // YC/Algolia unreachable — degrade to the next rung rather than throwing.
    if (signalsDebugEnabled()) {
      console.warn(`[yc-recovery] lookup error: ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
  }
  if (!match?.slug) return null;
  return pickFounderContact(await fetchFounders(match.slug));
}

/** TinyFish: read the company site (about/team) for a founder + LinkedIn URL. */
async function enrichViaTinyFish(
  lead: Pick<SignalLeadWithContacts, 'website'>,
): Promise<EnrichedContact | null> {
  const key = process.env.TINYFISH_API_KEY?.trim();
  if (!key || !lead.website) return null;

  try {
    const res = await fetch(AGENT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
      body: JSON.stringify({
        url: lead.website,
        goal:
          'Find the founders or leadership of this company from its site ' +
          '(about/team page). For each return name, role, and linkedin_url. Return JSON.',
        output_schema: FOUNDER_OUTPUT_SCHEMA,
      }),
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as {
      status?: string;
      error?: string | null;
      result?: { founders?: Array<Record<string, unknown>> };
    };
    if (payload.status !== 'COMPLETED' || payload.error) {
      if (signalsDebugEnabled()) {
        console.warn(`[tinyfish-enrich] run ${payload.status ?? 'unknown'}: ${payload.error ?? ''}`);
      }
      return null;
    }
    const found = (payload.result?.founders ?? []).find((f) => f.linkedin_url);
    if (!found) return null;
    return {
      name: found.name ? String(found.name) : undefined,
      role: found.role ? String(found.role) : undefined,
      linkedinUrl: String(found.linkedin_url),
      via: 'tinyfish',
    };
  } catch (err) {
    // Best-effort: a failed enrichment must never break the sync — log under debug.
    if (signalsDebugEnabled()) {
      console.warn(`[tinyfish-enrich] error: ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
  }
}

/** Apify: run a configured LinkedIn profile/people-search actor by company + name. */
async function enrichViaApify(
  lead: Pick<SignalLeadWithContacts, 'company_name' | 'contacts'>,
): Promise<EnrichedContact | null> {
  const token = process.env.APIFY_TOKEN?.trim();
  const actor = process.env.APIFY_LINKEDIN_PROFILE_ACTOR?.trim();
  if (!token || !actor) return null;

  // Prefer a known founder name if the directory scraped one without a URL.
  const founderName = lead.contacts?.find((c) => c.name)?.name ?? undefined;

  try {
    const client = new ApifyClient({ token });
    const run = await client.actor(actor).call({
      companyName: lead.company_name,
      ...(founderName ? { personName: founderName } : {}),
      maxItems: 1,
    });
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    const first = items?.[0] as Record<string, unknown> | undefined;
    const linkedinUrl = (first?.linkedinUrl ?? first?.profileUrl ?? first?.url) as string | undefined;
    if (!linkedinUrl) return null;
    return {
      name: first?.name ? String(first.name) : founderName,
      role: first?.title ? String(first.title) : undefined,
      linkedinUrl,
      via: 'apify',
    };
  } catch {
    return null;
  }
}

/** Injectable chat-completion fn so the web-search rung is unit-testable without a live LLM. */
export type CompleteFn = (
  system: string,
  user: string,
  opts?: { model?: string; temperature?: number },
) => Promise<string>;

const WEB_SEARCH_SYSTEM =
  'You are a precise research assistant with web access. Given a company, find its FOUNDER ' +
  'or CEO and that person\'s LinkedIn profile URL. Only report a person you can verify is ' +
  'actually associated with THIS specific company — never guess a name or invent a URL. ' +
  'Respond with STRICT JSON and nothing else: ' +
  '{"name": string|null, "role": string|null, "linkedin_url": string|null}. ' +
  'The linkedin_url must be a personal profile (linkedin.com/in/...), not a company page. ' +
  'If you are not confident, set the fields to null.';

/** Parses the strict-JSON web-search reply; null unless it yields a personal LinkedIn URL. */
function parseWebSearchReply(raw: string): { name?: string; role?: string; linkedinUrl: string } | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let obj: { name?: unknown; role?: unknown; linkedin_url?: unknown };
  try {
    obj = JSON.parse(match[0]);
  } catch {
    return null;
  }
  const url = typeof obj.linkedin_url === 'string' ? obj.linkedin_url.trim() : '';
  // Must be a personal profile, not a company page — company pages can't be messaged.
  if (!/linkedin\.com\/in\/[A-Za-z0-9\-_%]+/i.test(url)) return null;
  return {
    name: typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : undefined,
    role: typeof obj.role === 'string' && obj.role.trim() ? obj.role.trim() : undefined,
    linkedinUrl: url,
  };
}

/**
 * Universal founder lookup via web-search-capable LLM. Unlike the YC / TinyFish /
 * Apify rungs it needs no directory, key, or prior founder name — just the company
 * name — so it's the fallback for any non-YC source (arbitrary website, X, non-YC
 * ICP). The model is configurable via LLM_WEBSEARCH_MODEL (point it at a web-search
 * model — e.g. an ":online" / "sonar" variant, or a HuggingFace model — with no
 * code change); it falls back to the default chat model otherwise. Best-effort:
 * returns null when the LLM is unconfigured, errors, or is not confident. The
 * caller ALWAYS verifies the returned URL (Unipile) before it drives outreach, so
 * a hallucinated profile is caught rather than messaged.
 */
export async function enrichViaWebSearch(
  lead: Pick<SignalLeadWithContacts, 'company_name'> & { website?: string | null },
  deps: { complete?: CompleteFn } = {},
): Promise<EnrichedContact | null> {
  const company = lead.company_name?.trim();
  if (!company) return null;
  const model = process.env.LLM_WEBSEARCH_MODEL?.trim() || undefined;
  // Ships dark: the rung is inert until a dedicated web-search model is configured,
  // so a plain (non-browsing) default model can't hallucinate profiles in prod.
  // Tests inject `deps.complete` and are unaffected by the env gate.
  if (!model && !deps.complete) return null;
  const complete = deps.complete ?? chatCompletion;
  const user =
    `Company: ${company}` +
    (lead.website ? `\nWebsite: ${lead.website}` : '') +
    '\nReturn the founder/CEO name, role, and their personal LinkedIn URL as JSON.';

  let raw: string;
  try {
    raw = await complete(WEB_SEARCH_SYSTEM, user, { model, temperature: 0 });
  } catch (err) {
    // LLM unconfigured / budget-capped / provider error — degrade to the next rung.
    if (signalsDebugEnabled()) {
      console.warn(`[web-search-enrich] error: ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
  }

  const found = parseWebSearchReply(raw);
  if (!found) return null;
  return { name: found.name, role: found.role, linkedinUrl: found.linkedinUrl, via: 'web_search' };
}

/** Input for the Unipile name-search rung: a company plus the founder name we already have. */
export interface UnipileSearchInput {
  companyName: string;
  founderName?: string | null;
  /** Resolved workspace LinkedIn account id, or null when none is connected. */
  accountId?: string | null;
}

/** Contact-shaped result returned by the Unipile name-search rung. */
export interface FoundContact {
  name?: string;
  role?: string;
  linkedinUrl?: string;
  via: 'unipile';
}

/** Injectable search function so `enrichViaUnipileSearch` is unit-testable without hitting Unipile. */
type SearchFn = (q: { name: string; company: string; accountId?: string | null }) => Promise<{
  name?: string;
  role?: string;
  linkedinUrl?: string;
} | null>;

/**
 * Contact-ladder rung 4: deterministic Unipile people-search by founder name +
 * company. Only worth running when we already have a founder name (from YC
 * data, TinyFish, or Apify partial results) but still no LinkedIn URL.
 * `deps.search` is injectable for tests; defaults to the real Unipile lookup.
 */
export async function enrichViaUnipileSearch(
  input: UnipileSearchInput,
  deps: { search?: SearchFn } = {},
): Promise<FoundContact | null> {
  if (!input.founderName?.trim()) return null;
  const search = deps.search ?? defaultUnipileSearch;
  const hit = await search({ name: input.founderName, company: input.companyName, accountId: input.accountId });
  if (!hit?.linkedinUrl) return null;
  return { name: hit.name, role: hit.role, linkedinUrl: hit.linkedinUrl, via: 'unipile' };
}

/** Binds the real Unipile people-search; no-op (null) when Unipile is unconfigured, unaccounted, or errors. */
const defaultUnipileSearch: SearchFn = async ({ name, company, accountId }) => {
  if (!accountId) return null; // No connected LinkedIn account to search from.
  try {
    return await searchLinkedInPerson({ name, company, accountId });
  } catch (err) {
    // Unipile down/unconfigured: log under debug, fall through to no_contact.
    if (signalsDebugEnabled()) {
      console.warn(`[unipile-search] unexpected error: ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
  }
};
