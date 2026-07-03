import { ApifyClient } from 'apify-client';
import type { SignalLeadWithContacts } from '@/lib/signals/types';

/**
 * Founder-contact enrichment for leads the directory didn't hand a social URL.
 * Order (per product decision): TinyFish first (reuses the AgentQL key, cheaper),
 * Apify fallback (stronger LinkedIn data, paid). Both are gated on their creds and
 * best-effort — any failure returns null so the lead simply stays no_contact.
 */

const AGENTQL_ENDPOINT = 'https://api.agentql.com/v1/query-data';

export interface EnrichedContact {
  name?: string;
  role?: string;
  linkedinUrl?: string;
  via: 'tinyfish' | 'apify';
}

/** Runs the enrichment ladder; returns the first founder contact found, or null. */
export async function enrichFounderContact(
  lead: Pick<SignalLeadWithContacts, 'company_name' | 'website' | 'contacts'>,
): Promise<EnrichedContact | null> {
  const viaTinyfish = await enrichViaTinyFish(lead);
  if (viaTinyfish) return viaTinyfish;
  return enrichViaApify(lead);
}

/** TinyFish/AgentQL: read the company site (about/team) for a founder + LinkedIn URL. */
async function enrichViaTinyFish(
  lead: Pick<SignalLeadWithContacts, 'website'>,
): Promise<EnrichedContact | null> {
  const key = process.env.TINYFISH_API_KEY?.trim();
  if (!key || !lead.website) return null;

  try {
    const res = await fetch(AGENTQL_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
      body: JSON.stringify({
        url: lead.website,
        query: `{ founders[] { name role linkedin_url } }`,
      }),
    });
    if (!res.ok) return null;
    const payload = (await res.json()) as { data?: { founders?: Array<Record<string, unknown>> } };
    const found = (payload.data?.founders ?? []).find((f) => f.linkedin_url);
    if (!found) return null;
    return {
      name: found.name ? String(found.name) : undefined,
      role: found.role ? String(found.role) : undefined,
      linkedinUrl: String(found.linkedin_url),
      via: 'tinyfish',
    };
  } catch {
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
