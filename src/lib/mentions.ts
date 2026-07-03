/** Max @mentions allowed per generate request (matches /api/generate schema). */
export const MAX_MENTIONS = 10;

/**
 * Normalize a LinkedIn/X handle for the generate API (no leading @, trimmed).
 */
export function normalizeMentionHandle(raw: string): string {
  return raw.trim().replace(/^@+/, '').replace(/\s+/g, '');
}

/**
 * Parse comma- or space-separated handles from a URL param or text field.
 */
export function parseMentionList(raw: string): string[] {
  if (!raw.trim()) return [];
  return raw
    .split(/[,;\s]+/)
    .map(normalizeMentionHandle)
    .filter(Boolean);
}

/**
 * Extract `tag@handle` tokens from freeform text (e.g. "tag@rudheer" in topic).
 */
export function extractTagMentions(text: string): string[] {
  if (!text.trim()) return [];
  const found: string[] = [];
  const re = /\btag@([a-zA-Z0-9_.-]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const handle = normalizeMentionHandle(match[1]);
    if (handle) found.push(handle);
  }
  return found;
}

/**
 * Merge mention lists, dedupe case-insensitively, cap at MAX_MENTIONS.
 */
export function mergeMentions(...lists: string[][]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const raw of list) {
      const handle = normalizeMentionHandle(raw);
      if (!handle) continue;
      const key = handle.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(handle);
      if (out.length >= MAX_MENTIONS) return out;
    }
  }
  return out;
}
