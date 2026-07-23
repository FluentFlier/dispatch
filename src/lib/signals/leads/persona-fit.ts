const EXECUTIVE_ROLE = /\b(founder|co-?founder|ceo|chief executive|owner|president)\b/i;

export interface PersonaTarget {
  query: string;
  excludeExecutives: boolean;
}

/**
 * Extracts the person-level constraint that company discovery used to ignore.
 * The original prose remains the source of truth; this only distinguishes an
 * explicit IC ask from the resolver's historical founder/CEO default.
 */
export function inferPersonaTarget(description?: string | null): PersonaTarget | null {
  const text = description?.trim();
  if (!text) return null;
  const explicitIc = /\b(individual contributors?|non[- ]?manager(?:ial)?|non[- ]?executives?|practitioners?)\b/i.test(text);
  const explicitPeople =
    explicitIc ||
    /\b(people|persons?|professionals?|employees?|personas?|job roles?|buyers?|users?)\b/i.test(text) ||
    /\b(?:sell|selling|market|reach|connect|outreach|leads?|prospects?|customers?)\s+(?:to|for)?\s*(?:individual contributors?\s+)?(?:ux|user|product|design|market|customer|clinical|data|security|software)?\s*(?:researchers?|designers?|engineers?|analysts?|developers?)\b/i.test(text);
  const role = text.match(
    /\b(?:individual contributors?\s+)?((?:ux|user|product|design|market|customer|clinical|data|security|software)\s+(?:researchers?|designers?|engineers?|analysts?))\b/i,
  )?.[1] ?? text.match(/\b(researchers?|designers?|engineers?|analysts?|developers?)\b/i)?.[1];
  // A company ICP can mention roles as a signal ("companies hiring UX
  // researchers"). Do not turn that into person discovery unless the prose
  // explicitly identifies people/personas as the target.
  if (!explicitPeople || (!role && !explicitIc)) return null;
  return { query: role?.trim() || 'individual contributor', excludeExecutives: explicitIc };
}

export function roleFitsPersona(role: string | null | undefined, target: PersonaTarget): boolean {
  const value = role?.trim();
  if (!value) return false;
  if (target.excludeExecutives && EXECUTIVE_ROLE.test(value)) return false;
  const wanted = target.query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
  const haystack = value.toLowerCase();
  return wanted.some((token) => haystack.includes(token.replace(/s$/, '')));
}
