import { generateContent } from '@/lib/ai';
import { resolveModel } from '@/lib/ai-tiers';

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

/**
 * Extracts the first balanced top-level {...} object from arbitrary model output.
 * Handles markdown code fences and trailing prose that free models often add.
 * Returns the JSON substring, or null if no balanced object is found.
 */
function extractJsonObject(text: string): string | null {
  const cleaned = text.replace(/```(?:json)?/gi, '');
  const start = cleaned.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return cleaned.slice(start, i + 1);
    }
  }
  return null;
}

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
  const jsonText = extractJsonObject(raw);
  if (!jsonText) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const obj = parsed as Record<string, unknown>;
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
