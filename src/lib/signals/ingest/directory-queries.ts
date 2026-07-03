import type { LeadSource } from '@/lib/signals/types';

/**
 * Versioned AgentQL query config, one per directory. Kept as data (not baked
 * into the client) so a query can be tuned or a directory added without
 * touching client code or an SDK. `version` is logged on each run for
 * traceability when a directory changes its DOM and a query needs a bump.
 */
export interface DirectoryQueryConfig {
  version: number;
  /** Directory listing URL AgentQL runs against. */
  url: string;
  /** AgentQL query string (structured extraction). */
  query: string;
}

// Partial: `manual` leads (watchlist-created) have no directory query.
export const DIRECTORY_QUERIES: Partial<Record<LeadSource, DirectoryQueryConfig>> = {
  yc_directory: {
    version: 1,
    url: 'https://www.ycombinator.com/companies',
    query: `{
      companies[] {
        external_id(the company slug or unique id)
        company_name
        tagline
        website
        batch
        tags[]
        founders[] {
          name
          role
          linkedin_url
          x_handle
        }
      }
    }`,
  },
  yc_launches: {
    version: 1,
    url: 'https://www.ycombinator.com/launches',
    query: `{
      launches[] {
        external_id
        company_name
        tagline
        website
        batch
        tags[]
        founders[] { name role linkedin_url x_handle }
      }
    }`,
  },
  product_hunt: {
    version: 1,
    url: 'https://www.producthunt.com/',
    query: `{
      products[] {
        external_id(the product id or slug)
        company_name(product name)
        tagline
        website
        tags[]
        makers[] { name role linkedin_url x_handle }
      }
    }`,
  },
};
