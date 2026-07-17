import type { SignalLeadWithContacts, LeadCompanyDetail } from '@/lib/signals/types';

/** Human phrase for the lead's buying/hiring intent, mirroring the playbook builder. */
function intentSummary(flags: SignalLeadWithContacts['intent_flags']): string | null {
  const parts: string[] = [];
  if (flags?.raised) parts.push('recently raised');
  if (flags?.hiring) parts.push('hiring');
  if (flags?.seeking_investors) parts.push('raising');
  if (flags?.seeking_tools) parts.push('evaluating tools');
  return parts.length ? parts.join(', ') : null;
}

/** First sentence of a blurb, capped, for a tight one-liner. */
function firstSentence(text?: string | null): string | null {
  const t = text?.trim();
  if (!t) return null;
  const m = t.match(/^.*?[.!?](\s|$)/);
  return (m ? m[0] : t).trim().slice(0, 220);
}

export interface LeadSummary {
  /** What this lead is (company + one-line blurb). */
  what: string;
  /** Why it's worth pursuing (ICP fit + intent + space). Empty string if nothing to say. */
  why: string;
}

/**
 * Plain-language "what is this lead + why pursue", built entirely from stored
 * fields (no LLM, no network). Replaces the old "Claim used" strip. `what` reads
 * the tagline first, then the first sentence of the scraped company description;
 * `why` reuses the same ICP-fit/intent logic as the nurture playbook.
 */
export function summarizeLead(lead: SignalLeadWithContacts): LeadSummary {
  const detail = lead.company_detail as LeadCompanyDetail | undefined;
  const blurb = lead.tagline?.trim() || firstSentence(detail?.description) || null;

  // Avoid "Grand Ventures — Grand Ventures is…" when the blurb already leads with
  // the company name.
  const name = lead.company_name.trim();
  const startsWithName = blurb ? blurb.toLowerCase().startsWith(name.toLowerCase()) : false;
  const what = blurb ? (startsWithName ? blurb : `${name} — ${blurb}`) : name;

  const intent = intentSummary(lead.intent_flags);
  const space =
    Array.isArray(lead.tags) && lead.tags.length ? lead.tags.slice(0, 3).join(', ') : null;
  const whyParts = [
    'Fits your ICP',
    lead.batch ? `(${lead.batch})` : null,
    intent ? `· ${intent}` : null,
    space ? `· ${space}` : null,
  ].filter(Boolean);

  return { what, why: whyParts.join(' ') };
}

/**
 * Provenance URL captured at scrape time (LinkedIn company page today), stored in
 * `source_fact.source_url`. Returns null for leads scraped before capture existed
 * or from sources that don't carry it.
 */
export function leadSourceUrl(lead: SignalLeadWithContacts): string | null {
  const fact = lead.source_fact;
  if (fact && typeof fact === 'object' && 'source_url' in fact) {
    const url = (fact as { source_url?: unknown }).source_url;
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) return url;
  }
  return null;
}
