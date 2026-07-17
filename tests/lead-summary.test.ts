import { describe, it, expect } from 'vitest';
import { summarizeLead, leadSourceUrl } from '@/lib/signals/leads/summary';
import type { SignalLeadWithContacts } from '@/lib/signals/types';

/** Minimal lead stub - only the fields summarizeLead/leadSourceUrl read. */
function lead(partial: Partial<SignalLeadWithContacts>): SignalLeadWithContacts {
  return {
    company_name: 'Acme',
    tagline: null,
    tags: [],
    batch: null,
    intent_flags: {},
    source_fact: {},
    ...partial,
  } as SignalLeadWithContacts;
}

describe('summarizeLead', () => {
  it('prefixes company name when the blurb does not start with it', () => {
    expect(summarizeLead(lead({ tagline: 'early-stage VC fund' })).what).toBe(
      'Acme — early-stage VC fund',
    );
  });

  it('does NOT double the name when the blurb already leads with it', () => {
    expect(summarizeLead(lead({ company_name: 'Grand Ventures', tagline: 'Grand Ventures is a VC fund' })).what).toBe(
      'Grand Ventures is a VC fund',
    );
  });

  it('falls back to the first sentence of company_detail.description', () => {
    const l = lead({ company_detail: { description: 'Builds payroll tools. More text.' } } as Partial<SignalLeadWithContacts>);
    expect(summarizeLead(l).what).toBe('Acme — Builds payroll tools.');
  });

  it('builds a why line from ICP fit + intent + space', () => {
    const why = summarizeLead(lead({ batch: 'W24', intent_flags: { raised: true }, tags: ['Fintech'] })).why;
    expect(why).toContain('Fits your ICP');
    expect(why).toContain('W24');
    expect(why).toContain('recently raised');
    expect(why).toContain('Fintech');
  });

  it('falls back to just the company name when there is no blurb', () => {
    expect(summarizeLead(lead({})).what).toBe('Acme');
  });
});

describe('leadSourceUrl', () => {
  it('returns a stored https source_url', () => {
    expect(leadSourceUrl(lead({ source_fact: { source_url: 'https://linkedin.com/company/acme' } }))).toBe(
      'https://linkedin.com/company/acme',
    );
  });

  it('returns null when absent or not a url', () => {
    expect(leadSourceUrl(lead({ source_fact: { batch: 'W24' } }))).toBeNull();
    expect(leadSourceUrl(lead({ source_fact: { source_url: 'not-a-url' } }))).toBeNull();
  });
});
