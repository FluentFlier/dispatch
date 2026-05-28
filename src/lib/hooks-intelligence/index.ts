/**
 * Hook Intelligence - The phenomenal engine for Dispatch
 * 
 * - Free massive-scale mining via gstack
 * - Smart scoring + learned ranking (light RL)
 * - Social listening / always-on radar
 * - Powers better generation across the entire product
 */

import type { ExtractedHook, HookDataset, RankedHook, HookVertical } from './types';
import { DEFAULT_WATCHLIST } from './watchlist';
import { rankHooks, scoreHook } from './scorer';

const DATA_PATH = 'data/hooks-dataset.json';

let cachedDataset: HookDataset | null = null;

/**
 * Loader (hybrid for consumer SaaS).
 * Primary truth for mined intelligence is now hook_examples table (written by Apify prod-mining + research scripts + RL).
 * This file loader is kept for dev velocity and bootstrap. Retriever / voice already benefit from DB via other paths.
 */
export function loadHookDataset(): HookDataset {
  if (cachedDataset) return cachedDataset;

  try {
    const fs = require('fs');
    if (fs.existsSync(DATA_PATH)) {
      cachedDataset = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
      return cachedDataset!;
    }
  } catch {}

  // Bootstrap (populated at runtime by prod-mining.ts writing to DB + addHooksToDataset)
  return {
    version: '1.0.0',
    lastUpdated: new Date().toISOString(),
    hooks: [],
    scores: {},
  };
}

export function saveHookDataset(dataset: HookDataset) {
  try {
    const fs = require('fs');
    const dir = 'data';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DATA_PATH, JSON.stringify(dataset, null, 2));
    cachedDataset = dataset;
  } catch (e) {
    console.warn('Could not persist hook dataset (serverless ok — DB is source of truth via prod mining)');
  }
}

export function addHooksToDataset(newHooks: ExtractedHook[]) {
  const dataset = loadHookDataset();
  const existingIds = new Set(dataset.hooks.map(h => h.id));

  const uniqueNew = newHooks.filter(h => !existingIds.has(h.id));
  dataset.hooks.push(...uniqueNew);

  // Score the new ones
  uniqueNew.forEach(hook => {
    dataset.scores[hook.id] = scoreHook(hook);
  });

  dataset.lastUpdated = new Date().toISOString();
  saveHookDataset(dataset);

  return uniqueNew.length;
}

export function getBestHooksForContext(
  vertical?: HookVertical,
  limit = 10
): RankedHook[] {
  const dataset = loadHookDataset();
  if (dataset.hooks.length === 0) {
    // Fallback to the high-quality patterns we already have in voice-prompts/hooks.ts
    return [];
  }
  return rankHooks(dataset.hooks, vertical, limit);
}

/**
 * Social Listening entry point.
 * This is what keeps Dispatch "always on top".
 */
export async function runSocialListening(refreshAccounts = 20) {
  const { DEFAULT_WATCHLIST } = await import('./watchlist');
  const accounts = DEFAULT_WATCHLIST.accounts
    .sort((a, b) => b.priority - a.priority)
    .slice(0, refreshAccounts);

  console.log(`[Hook Intelligence] Social listening on ${accounts.length} accounts...`);

  // In production/research this would call the gstack extractor
  // For now it returns the watchlist so the research script knows what to mine
  return accounts;
}

/**
 * The "RLML" brain - simple but powerful.
 * Over time, as we collect real performance data from the app (engagement on generated posts
 * that used certain hooks), we reinforce the scores here.
 */
export function updateHookPerformance(hookId: string, delta: number) {
  const dataset = loadHookDataset();
  if (dataset.scores[hookId]) {
    const current = dataset.scores[hookId];
    const updated = {
      ...current,
      total: Math.min(100, Math.max(0, current.total + delta * 0.7)),
      confidence: Math.min(0.98, current.confidence + 0.03),
    };
    dataset.scores[hookId] = updated;
    saveHookDataset(dataset);
    return updated;
  }
  return null;
}

export { DEFAULT_WATCHLIST } from './watchlist';
export { rankHooks, scoreHook } from './scorer';
export { 
  getTopHooksTool, 
  searchHooksTool, 
  getSocialListeningInsightsTool,
  HOOK_INTELLIGENCE_TOOLS,
  toOpenAITools 
} from './agent-tools';
export { retrieveBestExamples, getHookContextForAgent } from './retriever';
export type { ExtractedHook, HookVertical, RankedHook } from './types';
