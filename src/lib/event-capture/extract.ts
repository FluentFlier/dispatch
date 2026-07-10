import { generateContent } from '@/lib/ai';
import { resolveModel } from '@/lib/ai-tiers';
import { parseLlmJson } from '@/lib/llm-json';

// --- Types ---

/** Structured facts extracted from an event's public web text. */
export interface ResearchFacts {
  summary: string;
  speakers: Array<{ name: string; title?: string; handle?: string }>;
  key_topics: string[];
  key_announcements: string[];
}

// --- Caps (mirror EventResearch storage limits) ---

const MAX_SPEAKERS = 5;
const MAX_TOPICS = 8;
const MAX_ANNOUNCEMENTS = 8;

// --- Extraction prompt ---

/**
 * Instructs the model to return ONLY a JSON object. Deliberately provider-neutral:
 * it does NOT rely on Anthropic structured-output (`output_config.format`), which
 * 400s on Groq/HF free models. Robustness comes from the defensive parser below,
 * so this works identically on Claude (prod) and Groq/HF (testing).
 */
const EXTRACTION_SYSTEM_PROMPT = `You extract structured facts about a professional event from web text.
Return ONLY a single JSON object, no prose, no markdown fences, matching exactly:
{
  "summary": "one-sentence plain-text summary of the event",
  "speakers": [{"name": "Full Name", "title": "role or company (optional)", "handle": "@handle (optional)"}],
  "key_topics": ["short topic phrase", "..."],
  "key_announcements": ["specific announcement made at the event", "..."]
}
Rules:
- Use ONLY facts present in the text. Do not invent speakers, topics, or announcements.
- If a field is unknown, use an empty string (summary) or empty array.
- No em dashes. No markdown. Plain text values only.`;

// --- Defensive JSON extraction ---
// Parsing is standardized on the shared parseLlmJson (see break 23); this file
// previously carried a byte-identical private copy of the balanced-brace extractor.

/** Dedupes strings case-insensitively, trims, drops empties, and caps length. */
function cleanStringList(value: unknown, cap: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= cap) break;
  }
  return out;
}

/** Coerces raw speaker entries to the typed shape, deduping by lowercased name. */
function cleanSpeakers(value: unknown): ResearchFacts['speakers'] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: ResearchFacts['speakers'] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const speaker: { name: string; title?: string; handle?: string } = { name };
    if (typeof raw.title === 'string' && raw.title.trim()) speaker.title = raw.title.trim();
    if (typeof raw.handle === 'string' && raw.handle.trim()) speaker.handle = raw.handle.trim();
    out.push(speaker);
    if (out.length >= MAX_SPEAKERS) break;
  }
  return out;
}

/**
 * Parses model output into ResearchFacts. Tolerant of fences and trailing prose.
 * Returns null when no usable JSON object is present so the caller can fall back.
 * Exported for direct unit testing of the parser without an LLM call.
 */
export function parseResearchFactsJson(raw: string): ResearchFacts | null {
  const parsed = parseLlmJson<Record<string, unknown>>(raw);
  if (!parsed || typeof parsed !== 'object') return null;

  const obj = parsed;
  return {
    summary: typeof obj.summary === 'string' ? obj.summary.trim() : '',
    speakers: cleanSpeakers(obj.speakers),
    key_topics: cleanStringList(obj.key_topics, MAX_TOPICS),
    key_announcements: cleanStringList(obj.key_announcements, MAX_ANNOUNCEMENTS),
  };
}

// --- Public API ---

/**
 * Extracts structured event facts (summary, speakers, topics, announcements) from
 * scraped page text using the configured LLM. Routes through generateContent at
 * the 'fast' tier, so it runs on the premium model in production and the free
 * model (Groq/HF) in testing with no code change (see ai-tiers.ts).
 *
 * Returns null — never throws — on empty input, LLM failure (incl. quota), or
 * unparseable output, so the caller degrades to snippet summary + empty fields.
 */
export async function extractResearchFacts(
  rawText: string,
  title: string,
): Promise<ResearchFacts | null> {
  if (!rawText.trim()) return null;

  try {
    const userPrompt = `Event title: ${title}\n\nWeb text:\n${rawText}`;
    const output = await generateContent(
      userPrompt,
      undefined,
      EXTRACTION_SYSTEM_PROMPT,
      null,
      resolveModel('fast'),
    );

    const facts = parseResearchFactsJson(output);
    if (!facts) {
      console.warn('[event-research] extraction returned unparseable output', { title });
      return null;
    }
    return facts;
  } catch (err) {
    console.warn('[event-research] extraction failed', { title, err });
    return null;
  }
}
