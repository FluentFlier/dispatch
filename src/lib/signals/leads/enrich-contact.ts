import type { createClient } from '@insforge/sdk';
import { ApifyClient } from 'apify-client';
import type { SignalLeadWithContacts } from '@/lib/signals/types';
import { signalsDebugEnabled } from '@/lib/signals/ingest/config';
import { fetchYcFounders } from '@/lib/signals/ingest/yc-algolia';
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
  via: 'yc_detail' | 'tinyfish' | 'apify' | 'unipile';
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
  if (opts.fastOnly) return null;
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

/** YC detail page: founder + LinkedIn from the company's /companies/<slug> page. */
async function enrichViaYcDetail(
  lead: Pick<SignalLeadWithContacts, 'source' | 'external_id'>,
): Promise<EnrichedContact | null> {
  if (lead.source !== 'yc_directory' || !lead.external_id) return null;
  const founders = await fetchYcFounders(lead.external_id);
  // Prefer a founder with a LinkedIn URL (needed to actually send a connect).
  const found = founders.find((f) => f.linkedinUrl) ?? founders[0];
  if (!found?.linkedinUrl) return null;
  return { name: found.name, role: found.role, linkedinUrl: found.linkedinUrl, via: 'yc_detail' };
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
