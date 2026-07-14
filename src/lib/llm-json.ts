// --- LLM JSON extraction ---
//
// Language models frequently wrap JSON in markdown fences, add trailing prose,
// or emit a structurally invalid object (a missing comma between array
// elements is the classic failure). A naive `JSON.parse(raw)` throws and takes
// the whole request down with it. These helpers extract the first balanced
// top-level object and parse it defensively, returning null instead of throwing
// so callers can retry or fall back.

/**
 * Extracts the first balanced top-level {...} object from arbitrary model
 * output. Walks the string tracking brace depth while respecting string
 * literals and escapes, so braces inside quoted values don't end the object.
 * Strips markdown code fences first. Returns the JSON substring, or null when
 * no balanced object is present.
 */
export function extractJsonObject(text: string): string | null {
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

/**
 * Parses the first balanced JSON object out of raw model output. Tolerant of
 * fences and trailing prose; returns null (never throws) when extraction or
 * JSON.parse fails, so the caller can decide whether to retry the model or fail
 * gracefully. The generic is a caller convenience only - no runtime validation
 * is performed, so validate the shape before trusting it.
 */
export function parseLlmJson<T = unknown>(raw: string): T | null {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) return null;
  try {
    return JSON.parse(jsonText) as T;
  } catch {
    return null;
  }
}
