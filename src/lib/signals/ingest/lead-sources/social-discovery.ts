import type { IngestedLead } from '@/lib/signals/types';
import { signalsDebugEnabled } from '@/lib/signals/ingest/config';
import { tinyfishSearch, tinyfishFetch, isTinyfishConfigured } from '@/lib/signals/ingest/tinyfish-web';
import { extractCompanyLeads, MAX_PAGE_CHARS } from '@/lib/signals/ingest/extract-companies';
import { isLlmConfiguredForDiscovery } from '@/lib/signals/ingest/lead-sources/web-discovery-config';
import { createApifyClient } from '@/lib/signals/ingest/apify-fetch';
import type { LeadDiscoveryAdapter } from '@/lib/signals/ingest/lead-sources/types';

const MAX_X_RESULTS = 12;
const LINKEDIN_ACTOR = 'harvestapi/linkedin-company-search';
const MAX_LINKEDIN = 25;

/** How many top X profile pages to fetch for substance beyond the snippets. */
const MAX_X_PAGE_FETCHES = 4;

/**
 * X discovery: TinyFish Search scoped to X for the ICP, then Fetch of the top
 * profile pages (bios/pinned posts carry the real company facts snippets lack),
 * then the shared ICP extractor with its grounding guard. A Fetch failure falls
 * back to snippets-only, so this is strictly better than the old snippet-only
 * path, never worse.
 */
export const xDiscoveryAdapter: LeadDiscoveryAdapter = {
  source: 'x',
  label: 'X',
  category: 'social',
  isAvailable: () => isTinyfishConfigured() && isLlmConfiguredForDiscovery(),
  discover: async (ctx) => {
    const q = ctx.icpQuery.trim() || ctx.icpDescription?.trim() || '';
    if (!q) return [];
    const results = await tinyfishSearch(`${q} startup founder site:x.com`, MAX_X_RESULTS);
    if (results.length === 0) return [];
    const serp = results
      .map((r) => `Title: ${r.title ?? ''}\nURL: ${r.url}\nSnippet: ${r.snippet ?? ''}`)
      .join('\n\n');

    let pages = '';
    try {
      const isXHost = (u: string): boolean => {
        try {
          const host = new URL(u).hostname.toLowerCase();
          return ['x.com', 'twitter.com'].some((d) => host === d || host.endsWith(`.${d}`));
        } catch {
          return false;
        }
      };
      const urls = results
        .map((r) => r.url)
        .filter(isXHost)
        .slice(0, MAX_X_PAGE_FETCHES);
      const fetched = urls.length > 0 ? await tinyfishFetch(urls) : [];
      pages = fetched
        .filter((p) => p.text?.trim())
        .map((p) => `--- Page: ${p.url} ---\n${p.text.slice(0, MAX_PAGE_CHARS)}`)
        .join('\n\n');
    } catch (err) {
      if (signalsDebugEnabled()) {
        console.warn(`[x-discovery] page fetch failed, snippets only: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return extractCompanyLeads(ctx, 'x', { serp, pages });
  },
};

/**
 * One company row from the harvestapi/linkedin-company-search dataset (full
 * mode). Field names vary across actor versions, so aliases are read
 * defensively - a missing field degrades to undefined, never breaks the map.
 */
interface LinkedinCompanyItem {
  name?: string;
  universalName?: string;
  industry?: string;
  summary?: string;
  description?: string;
  about?: string;
  website?: string;
  websiteUrl?: string;
  employeeCount?: number;
  employeesCount?: number;
  headquarter?: { city?: string; geographicArea?: string; country?: string } | string;
  location?: string;
  linkedinUrl?: string;
}

/** "City, Area, Country" from whatever headquarter shape the actor returned. */
function linkedinLocation(it: LinkedinCompanyItem): string | undefined {
  if (typeof it.headquarter === 'string' && it.headquarter.trim()) return it.headquarter.trim();
  if (it.headquarter && typeof it.headquarter === 'object') {
    const parts = [it.headquarter.city, it.headquarter.geographicArea, it.headquarter.country]
      .map((p) => p?.trim())
      .filter(Boolean);
    if (parts.length > 0) return parts.join(', ');
  }
  return it.location?.trim() || undefined;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

/**
 * LinkedIn discovery: Apify `harvestapi/linkedin-company-search` (no cookies).
 * `full` mode (~$0.004/company) so every lead lands with website, About text,
 * and headcount - these feed the company card and the description pipeline
 * directly (quality over cost per the product call; revisit if spend bites).
 * Contacts (founders) are resolved later by the shared enrichment path, so
 * leads land with founders: []. Gated on APIFY_TOKEN and bounded by MAX_LINKEDIN.
 */
export const linkedinDiscoveryAdapter: LeadDiscoveryAdapter = {
  source: 'linkedin',
  label: 'LinkedIn',
  category: 'social',
  isAvailable: () => Boolean(process.env.APIFY_TOKEN?.trim()),
  discover: async (ctx) => {
    const client = createApifyClient();
    const q = ctx.icpQuery.trim() || ctx.icpDescription?.trim() || '';
    if (!client || !q) return [];

    const run = await client.actor(LINKEDIN_ACTOR).call({
      searchQuery: q,
      scraperMode: 'full',
      maxItems: Math.min(ctx.maxLeads, MAX_LINKEDIN),
    });
    const { items } = await client.dataset(run.defaultDatasetId).listItems();

    const seen = new Set<string>();
    const leads: IngestedLead[] = [];
    for (const it of (items ?? []) as LinkedinCompanyItem[]) {
      const name = (it.name ?? '').trim();
      if (!name) continue;
      const externalId = `linkedin-${slugify(it.universalName || name)}`;
      if (seen.has(externalId)) continue;
      seen.add(externalId);
      leads.push({
        source: 'linkedin',
        externalId,
        companyName: name,
        tagline: it.summary?.trim() || undefined,
        longDescription: (it.description ?? it.about)?.trim() || undefined,
        website: (it.website ?? it.websiteUrl)?.trim() || undefined,
        teamSize: it.employeeCount ?? it.employeesCount ?? undefined,
        location: linkedinLocation(it),
        sourceUrl: it.linkedinUrl?.trim() || undefined,
        tags: it.industry ? [it.industry] : [],
        founders: [],
      });
    }
    if (signalsDebugEnabled()) console.log(`[linkedin-discovery] ${leads.length} companies`);
    return leads;
  },
};

export const socialAdapters: LeadDiscoveryAdapter[] = [
  linkedinDiscoveryAdapter,
  xDiscoveryAdapter,
];
