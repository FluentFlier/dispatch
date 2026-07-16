import type { LeadSource } from '@/lib/signals/types';
import { fetchDirectoryLeads, DirectoryScrapeError } from '@/lib/signals/ingest/tinyfish-fetch';
import { DIRECTORY_QUERIES } from '@/lib/signals/ingest/directory-queries';
import type { DiscoveryContext, LeadDiscoveryAdapter } from '@/lib/signals/ingest/lead-sources/types';

function createDirectoryAdapter(source: LeadSource): LeadDiscoveryAdapter {
  const config = DIRECTORY_QUERIES[source];
  return {
    source,
    label: source.replace(/_/g, ' '),
    category: 'directory',
    isAvailable: () => Boolean(config),
    discover: async (ctx: DiscoveryContext) => {
      if (!config) return [];
      return fetchDirectoryLeads(source, { icpQuery: ctx.icpQuery });
    },
  };
}

/**
 * Optional startup-directory adapters.
 *
 * product_hunt is DISABLED: producthunt.com is a JS SPA that the TinyFish Fetch
 * surface can't render, so the extractor saw skeleton HTML and hallucinated famous
 * brands (Slack, ChatGPT, "Product Hunt" itself) instead of real launches. Re-enable
 * only once it's rebuilt on a real data source (PH GraphQL API), the way yc_directory
 * moved to the Algolia index.
 * ponytail: dropped the source outright; wire the PH API before adding it back.
 */
export const directoryAdapters: LeadDiscoveryAdapter[] = (
  ['yc_directory', 'yc_launches'] as LeadSource[]
).map(createDirectoryAdapter);

export function isDirectorySource(source: LeadSource): boolean {
  return Boolean(DIRECTORY_QUERIES[source]);
}

export { DirectoryScrapeError };
