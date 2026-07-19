import type { ContentPillarConfig } from '@/types/database';

/** Matches the palette used by the ingest baseline so pillars look consistent. */
const PILLAR_COLORS = ['#E07A5F', '#D4A054', '#3D8B7A'];

const MAX_PILLARS = 3;
const MAX_NAME_LENGTH = 24;

/**
 * Used whenever derivation cannot produce anything usable. Onboarding must never
 * block on this call, so every failure path resolves to a working profile.
 */
export const DEFAULT_PILLARS: ContentPillarConfig[] = [
  { name: 'Insights', color: PILLAR_COLORS[0], description: 'Your core ideas' },
];

export const DERIVE_PILLARS_SYSTEM = [
  'You turn a one-line description of what someone posts about into content pillars.',
  'Reply ONLY with a compact JSON array, no prose and no markdown fences.',
  'Schema: [{"name":str,"description":str}]',
  'Return 2 or 3 pillars. Names are 1-3 words. Descriptions are one short phrase.',
].join(' ');

function readArray(raw: string): unknown[] | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced?.[1] ?? raw).trim();
  if (!candidate) return null;

  const attempts = [candidate];
  const bracketed = candidate.match(/\[[\s\S]*\]/);
  if (bracketed) attempts.push(bracketed[0]);

  for (const attempt of attempts) {
    try {
      const parsed: unknown = JSON.parse(attempt);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // try the next shape
    }
  }
  return null;
}

/**
 * Parses model output into pillars. Never throws and never returns an empty
 * array: unusable output degrades to DEFAULT_PILLARS.
 */
export function parseDerivedPillars(raw: string): ContentPillarConfig[] {
  const rows = readArray(raw);
  if (!rows) return DEFAULT_PILLARS;

  const pillars: ContentPillarConfig[] = [];
  for (const row of rows) {
    if (pillars.length >= MAX_PILLARS) break;
    if (!row || typeof row !== 'object') continue;

    const record = row as Record<string, unknown>;

    // Only accept string names; non-strings are treated as absent
    if (typeof record.name !== 'string') continue;
    const name = Array.from(record.name)
      .slice(0, MAX_NAME_LENGTH)
      .join('')
      .trim();
    if (!name) continue;

    // Only accept string descriptions; non-strings are treated as absent
    const description = typeof record.description === 'string'
      ? record.description.trim()
      : '';
    pillars.push({
      name,
      color: PILLAR_COLORS[pillars.length % PILLAR_COLORS.length],
      description: description || `Content about ${name.toLowerCase()}`,
    });
  }

  return pillars.length > 0 ? pillars : DEFAULT_PILLARS;
}
