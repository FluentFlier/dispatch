import type { LeadSource } from '@/lib/signals/types';

/**
 * Versioned TinyFish Agent config, one per directory. Kept as data (not baked
 * into the client) so a goal can be tuned or a directory added without touching
 * client code. `version` is logged on each run for traceability when a directory
 * changes its DOM and the goal needs a bump.
 *
 * We drive the TinyFish Agent surface (natural-language `goal` + `output_schema`)
 * rather than the retired AgentQL query language: the unified TinyFish key only
 * authenticates against *.tinyfish.ai, and the Agent surface renders JS-heavy
 * directory SPAs (YC/Product Hunt) that the Fetch surface times out on.
 */
export interface DirectoryQueryConfig {
  version: number;
  /** Directory listing URL the TinyFish agent navigates. */
  url: string;
  /** Natural-language extraction goal handed to the agent. */
  goal: string;
  /** Per-run company cap (interpolated into the goal to bound agent latency). */
  maxCompanies: number;
}

/**
 * Structured-output contract shared by every directory goal. Standardizing the
 * top-level key on `companies` (even for Product Hunt "products") lets the
 * normalizer read one shape regardless of source.
 */
export const LEAD_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    companies: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          external_id: { type: 'string' },
          company_name: { type: 'string' },
          tagline: { type: 'string' },
          website: { type: 'string' },
          batch: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          founders: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                role: { type: 'string' },
                linkedin_url: { type: 'string' },
                x_handle: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
} as const;

// Partial: `manual` leads (watchlist-created) have no directory goal.
//
// Goals are LISTING-ONLY by design: the agent must not open individual company
// pages. Founder/LinkedIn data lives on per-company subpages - visiting N of them
// turns one ~60s run into a 5+ minute run that trips the socket timeout. Founder
// contacts are resolved later, per-lead, by the enrichment path instead. Keep
// maxCompanies small: agent latency is high and variable (~60-130s regardless).
export const DIRECTORY_QUERIES: Partial<Record<LeadSource, DirectoryQueryConfig>> = {
  // NOTE: yc_directory is served by the YC Algolia index (see yc-algolia.ts), not
  // the agent `goal` below - maxCompanies is used as the Algolia hit count. The
  // goal/url are retained as documentation and a potential agent fallback.
  yc_directory: {
    version: 3,
    url: 'https://www.ycombinator.com/companies',
    maxCompanies: 25,
    goal:
      'Go to the Y Combinator company directory. The page loads companies ' +
      'dynamically, so WAIT for the company cards to appear and scroll down a few ' +
      'times until at least {maxCompanies} company cards are loaded. Then, from the ' +
      'loaded listing cards ONLY (do NOT open individual company pages), extract ' +
      '{maxCompanies} companies. For each: external_id (the slug from its ' +
      '/companies/<slug> link), company_name, tagline, batch, tags. Return JSON.',
  },
  yc_launches: {
    version: 3,
    url: 'https://www.ycombinator.com/launches',
    maxCompanies: 10,
    goal:
      'Go to the YC Launches page. It loads dynamically, so WAIT for the launch ' +
      'cards to appear and scroll down until at least {maxCompanies} are loaded. ' +
      'Then, from the loaded cards ONLY (do NOT open individual launch pages), ' +
      'extract {maxCompanies} recent launches. For each: external_id (launch slug ' +
      'or id), company_name, tagline, batch, tags. Return JSON.',
  },
  product_hunt: {
    version: 3,
    url: 'https://www.producthunt.com/',
    maxCompanies: 10,
    goal:
      'Go to the Product Hunt homepage. It loads dynamically, so WAIT for the ' +
      'product list to appear and scroll down until at least {maxCompanies} products ' +
      'are loaded. Then, from the loaded list ONLY (do NOT open individual product ' +
      'pages), extract {maxCompanies} top products into the companies array. For ' +
      'each: external_id (product slug or id), company_name (the product name), ' +
      'tagline, tags. Return JSON.',
  },
};

/** Fills the {maxCompanies} placeholder in a directory goal. */
export function renderGoal(config: DirectoryQueryConfig): string {
  return config.goal.replace('{maxCompanies}', String(config.maxCompanies));
}
