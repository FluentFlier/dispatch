import { describe, it, expect } from 'vitest';
import { summarizeLead } from '@/lib/signals/leads/summary';
import type { SignalLeadWithContacts } from '@/lib/signals/types';

/**
 * The "Why pursue" line used to open with the hardcoded string "Fits your ICP"
 * for every lead, no matter what the saved ICP was. A water-risk company
 * surfaced under a seed-fintech ICP still claimed to fit. These cases pin the
 * claim to the stored fit_score so it can never drift back to an assertion the
 * app has not actually computed.
 */
function lead(overrides: Partial<SignalLeadWithContacts>): SignalLeadWithContacts {
  return {
    company_name: 'Waterplan',
    tagline: 'Water risk mitigation for industrial sites',
    batch: 'Summer 2021',
    tags: ['B2B'],
    intent_flags: {},
    fit_score: 0,
    ...overrides,
  } as SignalLeadWithContacts;
}

describe('summarizeLead - ICP claim', () => {
  it('never claims a match for an unscored lead', () => {
    const { why } = summarizeLead(lead({ fit_score: 0 }));
    expect(why).not.toMatch(/ICP/i);
    // Still reports the facts it genuinely has.
    expect(why).toContain('Summer 2021');
    expect(why).toContain('B2B');
  });

  it('calls a low score a weak match rather than a fit', () => {
    const { why } = summarizeLead(lead({ fit_score: 0.2 }));
    expect(why).toContain('Weak ICP match');
  });

  it('distinguishes partial from strong', () => {
    expect(summarizeLead(lead({ fit_score: 0.5 })).why).toContain('Partial ICP match');
    expect(summarizeLead(lead({ fit_score: 0.85 })).why).toContain('Strong ICP match');
  });

  it('tolerates a missing or malformed score without inventing a match', () => {
    expect(summarizeLead(lead({ fit_score: undefined as never })).why).not.toMatch(/ICP/i);
    expect(summarizeLead(lead({ fit_score: NaN })).why).not.toMatch(/ICP/i);
  });
});
