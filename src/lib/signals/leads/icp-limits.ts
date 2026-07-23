/** One shared contract for every manual/API ICP editor. */
export const MAX_ICP_VERTICALS = 12;
export const MAX_ICP_KEYWORDS = 30;
export const MAX_ICP_FIELD_LENGTH = 120;

export function normalizeIcpTerms(values: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = String(raw).trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length === max) break;
  }
  return out;
}
