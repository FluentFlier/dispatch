import type { IngestedLead } from '@/lib/signals/types';
import { signalsDebugEnabled } from '@/lib/signals/ingest/config';
import { tinyfishSearch, isTinyfishConfigured } from '@/lib/signals/ingest/tinyfish-web';
import { extractCompanyLeads } from '@/lib/signals/ingest/extract-companies';
import { isLlmConfiguredForDiscovery } from '@/lib/signals/ingest/lead-sources/web-discovery-config';
import { createApifyClient } from '@/lib/signals/ingest/apify-fetch';
import type { LeadDiscoveryAdapter } from '@/lib/signals/ingest/lead-sources/types';

const MAX_X_RESULTS = 12;
const LINKEDIN_ACTOR = 'harvestapi/linkedin-company-search';
const MAX_LINKEDIN = 25;

/**
 * X discovery: TinyFish Search scoped to X for the ICP, then the shared ICP
 * extractor pulls real companies out of the (noisy) profile/post snippets - the
 * LLM ICP filter drops tweets/profiles that aren't companies. Reuses the exact
 * Search + extract path web_discovery uses, so no new scraping infra.
 * ponytail: snippet-only (no per-URL Fetch). Add Fetch of top X profiles if the
 * snippets prove too thin.
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
    return extractCompanyLeads(ctx, 'x', { serp });
  },
};

/** One company row from the harvestapi/linkedin-company-search dataset (short mode). */
interface LinkedinCompanyItem {
  name?: string;
  universalName?: string;
  industry?: string;
  summary?: string;
  linkedinUrl?: string;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

/**
 * LinkedIn discovery: Apify `harvestapi/linkedin-company-search` (no cookies,
 * ~$0.002/company). Searches LinkedIn companies for the ICP query and maps each to
 * a lead. Contacts (founders) are resolved later by the shared enrichment path, so
 * leads land with founders: []. Gated on APIFY_TOKEN and bounded by MAX_LINKEDIN.
 * ponytail: `short` mode (no website field); switch to `full` (+$0.002/co) if the
 * lead card needs the company website/headcount.
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
      scraperMode: 'short',
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
