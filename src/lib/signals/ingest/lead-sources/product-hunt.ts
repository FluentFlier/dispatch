import type { IngestedLead } from '@/lib/signals/types';
import { signalsDebugEnabled } from '@/lib/signals/ingest/config';
import type { LeadDiscoveryAdapter } from '@/lib/signals/ingest/lead-sources/types';

/**
 * Product Hunt discovery via the OFFICIAL GraphQL API (v2).
 *
 * The old TinyFish-scraped path is gone for good reason: producthunt.com is a
 * JS SPA, Fetch saw skeleton HTML, and the extractor hallucinated famous
 * brands. The API returns real launch data, so there is no extraction LLM and
 * no hallucination surface at all.
 *
 * Auth: PRODUCT_HUNT_API_TOKEN (a developer token from
 * https://www.producthunt.com/v2/oauth/applications). Absent token = adapter
 * unavailable, source toggle disabled.
 */
const PH_API_URL = 'https://api.producthunt.com/v2/api/graphql';
const MAX_POSTS = 40;
const TIMEOUT_MS = 20_000;

const POSTS_QUERY = `
query NewestPosts($first: Int!) {
  posts(order: NEWEST, first: $first) {
    edges {
      node {
        slug
        name
        tagline
        description
        url
        website
        topics(first: 5) { edges { node { name } } }
      }
    }
  }
}`;

interface PhPostNode {
  slug?: string;
  name?: string;
  tagline?: string;
  description?: string;
  url?: string;
  website?: string;
  topics?: { edges?: Array<{ node?: { name?: string } }> };
}

export function isProductHuntConfigured(): boolean {
  return Boolean(process.env.PRODUCT_HUNT_API_TOKEN?.trim());
}

async function fetchNewestPosts(first: number): Promise<PhPostNode[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(PH_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.PRODUCT_HUNT_API_TOKEN?.trim()}`,
      },
      body: JSON.stringify({ query: POSTS_QUERY, variables: { first } }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`Product Hunt API ${res.status}`);
    }
    const json = (await res.json()) as {
      data?: { posts?: { edges?: Array<{ node?: PhPostNode }> } };
      errors?: Array<{ message?: string }>;
    };
    if (json.errors?.length) {
      throw new Error(`Product Hunt API: ${json.errors[0]?.message ?? 'GraphQL error'}`);
    }
    return (json.data?.posts?.edges ?? [])
      .map((e) => e.node)
      .filter((n): n is PhPostNode => Boolean(n));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Deterministic ICP relevance filter: keep a launch when any ICP vertical or
 * keyword appears in its name/tagline/description/topics. No ICP configured =
 * keep everything (scoring ranks later). Free and unfoolable, unlike an LLM.
 */
export function matchesIcpTerms(
  node: PhPostNode,
  verticals: string[],
  keywords: string[],
): boolean {
  const terms = [...verticals, ...keywords].map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (terms.length === 0) return true;
  const topicNames = (node.topics?.edges ?? []).map((e) => e.node?.name ?? '');
  const hay = [node.name, node.tagline, node.description, ...topicNames]
    .join(' ')
    .toLowerCase();
  return terms.some((t) => hay.includes(t));
}

export const productHuntAdapter: LeadDiscoveryAdapter = {
  source: 'product_hunt',
  label: 'Product Hunt',
  category: 'directory',
  isAvailable: isProductHuntConfigured,
  discover: async (ctx) => {
    const nodes = await fetchNewestPosts(Math.min(Math.max(ctx.maxLeads, 1), MAX_POSTS));
    const leads: IngestedLead[] = [];
    for (const node of nodes) {
      const name = node.name?.trim();
      const slug = node.slug?.trim();
      if (!name || !slug) continue;
      if (!matchesIcpTerms(node, ctx.icpVerticals, ctx.icpKeywords)) continue;
      leads.push({
        source: 'product_hunt',
        externalId: slug,
        companyName: name,
        tagline: node.tagline?.trim() || undefined,
        longDescription: node.description?.trim() || undefined,
        website: node.website?.trim() || undefined,
        sourceUrl: node.url?.trim() || undefined,
        tags: (node.topics?.edges ?? [])
          .map((e) => e.node?.name?.trim())
          .filter((t): t is string => Boolean(t))
          .slice(0, 8),
        founders: [],
      });
    }
    if (signalsDebugEnabled()) {
      console.log(`[product-hunt] ${leads.length}/${nodes.length} launches match the ICP`);
    }
    return leads;
  },
};
