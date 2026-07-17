import type { LeadSource } from '@/lib/signals/types';
import { fetchDirectoryLeads, DirectoryScrapeError } from '@/lib/signals/ingest/tinyfish-fetch';
import { DIRECTORY_QUERIES } from '@/lib/signals/ingest/directory-queries';
import { productHuntAdapter } from '@/lib/signals/ingest/lead-sources/product-hunt';
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
 * Startup-directory adapters. YC comes via its Algolia index; Product Hunt via
 * its OFFICIAL GraphQL API (the old TinyFish-scraped PH path hallucinated famous
 * brands from SPA skeleton HTML and is gone - see product-hunt.ts).
 */
export const directoryAdapters: LeadDiscoveryAdapter[] = [
  ...(['yc_directory', 'yc_launches'] as LeadSource[]).map(createDirectoryAdapter),
  productHuntAdapter,
];

export function isDirectorySource(source: LeadSource): boolean {
  return Boolean(DIRECTORY_QUERIES[source]);
}

export { DirectoryScrapeError };
