/**
 * Agent Tools for Hook Intelligence + Social Listening
 * 
 * These are designed to be dropped into:
 * - LangChain / LangGraph tools
 * - OpenAI function calling (via InsForge AI gateway)
 * - Any custom agent (Claude tools, etc.)
 * 
 * Goal: Give agents live access to the best real-world hooks + social signals
 * so they can create *actually amazing* posts, not generic slop.
 */

import { getBestHooksForContext, loadHookDataset, runSocialListening, retrieveBestExamples } from './index';
import type { HookVertical } from './types';

export interface GetTopHooksArgs {
  vertical?: HookVertical;
  limit?: number;
  context?: string; // e.g. "launching a new AI product"
}

export interface SearchHooksArgs {
  query: string;
  vertical?: HookVertical;
  limit?: number;
}

export interface SocialListeningInsightsArgs {
  limitAccounts?: number;
}

/**
 * Tool: get_top_hooks
 * Returns the highest-ranked, real mined hooks for a vertical/context.
 * This is the #1 way agents get "amazing" material.
 */
export function getTopHooksTool(args: GetTopHooksArgs) {
  const hooks = args.context 
    ? retrieveBestExamples({ query: args.context, vertical: args.vertical, limit: args.limit ?? 8 })
    : getBestHooksForContext(args.vertical, args.limit ?? 8);
  
  return {
    hooks: hooks.map(h => ({
      text: h.text,
      author: h.author,
      score: (h as any).score?.total || 75,
      verticals: h.verticals,
    })),
    count: hooks.length,
    note: "Real high-performing examples mined via gstack from top creators (Imagine-style quality data). Use structures for amazing posts.",
  };
}

/**
 * Tool: search_hooks
 * Semantic-ish search over the growing dataset (simple for now, can be upgraded to embeddings).
 */
export function searchHooksTool(args: SearchHooksArgs) {
  const dataset = loadHookDataset();
  const q = args.query.toLowerCase();
  
  const matches = dataset.hooks
    .filter(h => 
      h.text.toLowerCase().includes(q) || 
      h.author.toLowerCase().includes(q)
    )
    .slice(0, args.limit ?? 10);

  return {
    results: matches.map(h => ({
      text: h.text,
      author: h.author,
      verticals: h.verticals,
    })),
    query: args.query,
  };
}

/**
 * Tool: get_social_listening_insights
 * What are top accounts in the watchlist posting right now? (fresh signals)
 */
export async function getSocialListeningInsightsTool(args: SocialListeningInsightsArgs = {}) {
  const { DEFAULT_WATCHLIST } = await import('./watchlist');
  const limit = args.limitAccounts ?? 15;
  const watchlist = DEFAULT_WATCHLIST.accounts
    .sort((a, b) => b.priority - a.priority)
    .slice(0, limit);

  const listening = await runSocialListening(limit);

  return {
    watchlist_sample: watchlist.map((a) => ({
      handle: a.handle,
      verticals: a.verticals,
      priority: a.priority,
    })),
    listening_status: listening.status,
    handles: listening.handles,
    mining: 'mining' in listening ? listening.mining : undefined,
    recommendation:
      ('hint' in listening && listening.hint) ||
      'Run the research miner against these accounts for the freshest high-conversion patterns.',
    last_refreshed: new Date().toISOString(),
  };
}

/**
 * Full set of tools ready for LangChain / LangGraph / OpenAI function calling.
 * 
 * Example usage in an agent:
 * tools = [
 *   { name: "get_top_hooks", description: "...", parameters: ... },
 *   ...
 * ]
 */
export const HOOK_INTELLIGENCE_TOOLS = [
  {
    name: "get_top_hooks",
    description: "Get the best real-world, high-conversion hooks for a specific vertical or context. Essential for creating posts that actually perform.",
    parameters: {
      type: "object",
      properties: {
        vertical: { type: "string", enum: ["indie_maker", "direct_response", "thread_systems", "one_person_business", "visual_design", "audience_building", "mindset", "copywriting"] },
        limit: { type: "number", default: 8 },
        context: { type: "string", description: "What the post is about (e.g. product launch, personal story)" },
      },
    },
  },
  {
    name: "search_hooks",
    description: "Search the growing library of mined high-performing hooks by keyword or topic.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        vertical: { type: "string" },
        limit: { type: "number", default: 10 },
      },
      required: ["query"],
    },
  },
  {
    name: "get_social_listening_insights",
    description: "See what top creators in our watchlist are currently posting. Use this to stay on the cutting edge of formats and topics.",
    parameters: {
      type: "object",
      properties: {
        limitAccounts: { type: "number", default: 15 },
      },
    },
  },
] as const;

/**
 * Helper to turn these into OpenAI-compatible tool definitions (for InsForge AI or LangChain OpenAI).
 */
export function toOpenAITools() {
  return HOOK_INTELLIGENCE_TOOLS.map(t => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}
