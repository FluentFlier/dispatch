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

/** Optional startup-directory adapters (YC, Product Hunt). */
export const directoryAdapters: LeadDiscoveryAdapter[] = (
  ['yc_directory', 'yc_launches', 'product_hunt'] as LeadSource[]
).map(createDirectoryAdapter);

export function isDirectorySource(source: LeadSource): boolean {
  return Boolean(DIRECTORY_QUERIES[source]);
}

export { DirectoryScrapeError };
