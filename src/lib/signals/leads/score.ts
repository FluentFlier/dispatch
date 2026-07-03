import type { DirectorySettingsRow, LeadIntentFlags, SignalLeadRow } from '@/lib/signals/types';

/** Lowercase token set from free text (words 3+ chars). */
function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3),
  );
}

/**
 * ICP fit in [0,1] = fraction of configured verticals/keywords that appear in
 * the lead's tags + tagline. Deterministic (no RNG). Empty ICP → neutral 0.5
 * so nothing is starved before the user configures a profile.
 */
export function computeFitScore(
  lead: Pick<SignalLeadRow, 'tags' | 'tagline' | 'company_name'>,
  settings: Pick<DirectorySettingsRow, 'icp_verticals' | 'icp_keywords'>,
): number {
  const wanted = [...settings.icp_verticals, ...settings.icp_keywords]
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean);
  if (wanted.length === 0) return 0.5;

  const haystackText = [lead.tagline ?? '', lead.company_name ?? '', ...(lead.tags ?? [])]
    .join(' ')
    .toLowerCase();
  const haystack = tokens(haystackText);
  const hits = wanted.filter((w) =>
    w.includes(' ') ? haystackText.includes(w) : haystack.has(w),
  ).length;
  return hits / wanted.length;
}

/** Sum of set intent flags (drives reactivation boost). */
function intentBoost(flags: LeadIntentFlags): number {
  return (
    (flags.raised ? 0.4 : 0) +
    (flags.seeking_investors ? 0.3 : 0) +
    (flags.seeking_tools ? 0.3 : 0) +
    (flags.hiring ? 0.2 : 0)
  );
}

/**
 * Composite rank: fit + freshness (surfaced today) + intent, minus a penalty
 * for leads with no reachable contact so actionable leads float up while
 * un-actionable ones stay visible (transparency), never hidden.
 */
export function computeRankScore(
  lead: Pick<SignalLeadRow, 'intent_flags' | 'contact_status' | 'digest_date'>,
  fitScore: number,
  today: string,
): number {
  const freshness = lead.digest_date === today ? 0.3 : 0;
  const intent = intentBoost(lead.intent_flags ?? {});
  const penalty = lead.contact_status === 'no_contact' ? 0.5 : 0;
  return Number((fitScore + freshness + intent - penalty).toFixed(4));
}
