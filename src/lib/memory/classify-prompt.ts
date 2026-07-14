import { generateContent } from '@/lib/ai';
import { resolveModel } from '@/lib/ai-tiers';

export interface PromptMemoryPlan {
  topics: string[];
  time_scope: 'recent' | 'specific' | 'any';
  /** Entity-rich query for semantic memory search - includes proper nouns
   *  verbatim so a specific past post ranks above generic history. */
  search_query: string;
}

const SYSTEM = [
  "You route a content-generation prompt to the user's memory search.",
  'Return ONLY a JSON object, no prose, with exactly these keys:',
  '{"topics": string[], "time_scope": "recent"|"specific"|"any", "search_query": string}',
  '- time_scope "specific": the prompt references a particular past event, post, or',
  '  moment (e.g. "remember the Forbes event", "that talk I gave last year"). Set',
  '  search_query to the exact entities / proper nouns named.',
  '- time_scope "recent": the prompt wants something tied to lately / current momentum.',
  '- time_scope "any": a general topic with no temporal anchor.',
  '- search_query: short and entity-rich. No prose, no quotes around it.',
  '- topics: 1-4 short topic keywords.',
].join('\n');

// Deterministic signals that a prompt references a SPECIFIC past event/moment
// (the class the LLM classifier must not misjudge, e.g. "remember the Forbes
// event", "reflect on that talk last year"). Used as a floor so retrieval steers
// to specific-scope (limit 10 + entity query) even when the model hiccups.
const SPECIFIC_SIGNALS =
  /\b(remember|recap|reflect(?:ing)? on|revisit(?:ing)?|looking back|think back|back (?:in|at|when)|last (?:year|month|week|summer|fall|autumn|spring|winter|night|time)|that (?:event|talk|trip|conference|summit|meetup|dinner|panel|call|moment|day)|when i (?:met|went|spoke|attended|was at|got))\b/i;

// Words that are capitalized for grammar/imperative reasons, not entities.
const ENTITY_STOP = new Set([
  'write', 'post', 'create', 'draft', 'make', 'tweet', 'a', 'an', 'the', 'i',
  'my', 'me', 'about', 'on', 'for', 'remember', 'recap', 'reflect', 'and', 'to',
]);

/** Proper-noun-ish tokens from a prompt, for an entity-rich memory query. */
function extractEntities(prompt: string): string {
  const toks: string[] = [];
  for (const m of Array.from(prompt.matchAll(/\b[A-Z][a-zA-Z0-9]+\b/g))) {
    if (!ENTITY_STOP.has(m[0].toLowerCase())) toks.push(m[0]);
  }
  return Array.from(new Set(toks)).slice(0, 12).join(' ');
}

/** Union of two space-separated queries, deduped, length-capped. */
function mergeQueries(a: string, b: string): string {
  return Array.from(new Set(`${a} ${b}`.split(/\s+/).filter(Boolean))).slice(0, 20).join(' ');
}

/** Pure, no-LLM plan from surface signals - the deterministic floor. */
function heuristicPlan(prompt: string): PromptMemoryPlan {
  const entities = extractEntities(prompt);
  return {
    topics: [],
    time_scope: SPECIFIC_SIGNALS.test(prompt) ? 'specific' : 'any',
    search_query: entities || prompt.slice(0, 200),
  };
}

function fallbackPlan(prompt: string): PromptMemoryPlan {
  return { topics: [], time_scope: 'any', search_query: prompt.slice(0, 200) };
}

function parsePlan(raw: string, prompt: string): PromptMemoryPlan {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return fallbackPlan(prompt);
  try {
    const obj = JSON.parse(raw.slice(start, end + 1)) as Partial<PromptMemoryPlan>;
    const scope = obj.time_scope;
    return {
      topics: Array.isArray(obj.topics) ? obj.topics.filter((t): t is string => typeof t === 'string') : [],
      time_scope: scope === 'recent' || scope === 'specific' ? scope : 'any',
      search_query:
        typeof obj.search_query === 'string' && obj.search_query.trim()
          ? obj.search_query.trim()
          : prompt.slice(0, 200),
    };
  } catch {
    return fallbackPlan(prompt);
  }
}

/**
 * Classifies a generation prompt to steer memory retrieval. Runs on the cheap
 * `fast` model tier (same class as Event Capture's question generation), a single
 * short call. NEVER throws - any failure degrades to the naive whole-prompt query
 * so a classifier hiccup can't block generation.
 */
export async function classifyPromptForMemory(prompt: string): Promise<PromptMemoryPlan> {
  const heuristic = heuristicPlan(prompt);
  try {
    const raw = await generateContent(prompt, undefined, SYSTEM, null, resolveModel('fast'));
    const plan = parsePlan(raw, prompt);
    // Deterministic floor: only when surface signals say SPECIFIC but the model
    // did NOT - upgrade scope and enrich the query with the proper nouns it
    // dropped. When the model already returned specific, trust its query as-is
    // (merging would dedupe/mangle a good query like "Forbes 30 Under 30").
    // Only upgrades retrieval; never downgrades.
    if (heuristic.time_scope === 'specific' && plan.time_scope !== 'specific') {
      return {
        ...plan,
        time_scope: 'specific',
        search_query: mergeQueries(plan.search_query, heuristic.search_query),
      };
    }
    return plan;
  } catch (err) {
    console.warn('[memory] prompt classifier failed, using deterministic plan', err);
    return heuristic;
  }
}
