import { generateContent } from '@/lib/ai';
import { resolveModel } from '@/lib/ai-tiers';

export interface PromptMemoryPlan {
  topics: string[];
  time_scope: 'recent' | 'specific' | 'any';
  /** Entity-rich query for semantic memory search — includes proper nouns
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
 * short call. NEVER throws — any failure degrades to the naive whole-prompt query
 * so a classifier hiccup can't block generation.
 */
export async function classifyPromptForMemory(prompt: string): Promise<PromptMemoryPlan> {
  try {
    const raw = await generateContent(prompt, undefined, SYSTEM, null, resolveModel('fast'));
    return parsePlan(raw, prompt);
  } catch (err) {
    console.warn('[memory] prompt classifier failed, using naive query', err);
    return fallbackPlan(prompt);
  }
}
