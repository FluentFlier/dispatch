import { describe, it, expect } from 'vitest';
import { mentionsCompany } from '@/lib/signals/leads/describe';
import type { SignalLeadWithContacts } from '@/lib/signals/types';

function lead(p: Partial<SignalLeadWithContacts>): SignalLeadWithContacts {
  return { company_name: 'Grand Ventures', domain: null, ...p } as SignalLeadWithContacts;
}

describe('mentionsCompany (anti-hallucination grounding)', () => {
  it('matches on the full company name', () => {
    expect(mentionsCompany('Grand Ventures is an early-stage fund.', lead({}))).toBe(true);
  });

  it('matches on a significant first-name token', () => {
    expect(mentionsCompany('About GRAND: we invest in seed startups.', lead({}))).toBe(true);
  });

  it('matches on the domain', () => {
    expect(mentionsCompany('Visit grandvc.com for details.', lead({ domain: 'www.grandvc.com' }))).toBe(true);
  });

  it('rejects source text that is not about the company', () => {
    expect(mentionsCompany('This page is about a completely unrelated bakery.', lead({}))).toBe(false);
  });

  it('does not match on a short (<4 char) token', () => {
    // "ABC Co" → token "ABC" is length 3, must not loosely match random text
    expect(mentionsCompany('The alphabet has letters.', lead({ company_name: 'ABC Co' }))).toBe(false);
  });
});
