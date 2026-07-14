import { describe, it, expect } from 'vitest';
import { enrichViaYcRecovery } from '@/lib/signals/leads/enrich-contact';
import type { YcFounder } from '@/lib/signals/ingest/yc-algolia';

/**
 * Track A / A1: ICP-finder leads land as source:'manual' with no founders, but the
 * companies are real YC companies. This rung recovers their real YC slug by name
 * (Algolia) and pulls the founder LinkedIn from the YC detail page - turning an
 * unreachable manual lead into a resolved contact on the free, existing YC path.
 */
describe('Phase: YC identity recovery for manual/ICP leads', () => {
  const founders: YcFounder[] = [
    { name: 'Ann Chen', role: 'CTO', linkedinUrl: 'https://linkedin.com/in/ann-cto' },
    { name: 'Bo Lee', role: 'Founder & CEO', linkedinUrl: 'https://linkedin.com/in/bo-ceo' },
  ];

  it('recovers a manual lead that is really a YC company and returns the CEO contact', async () => {
    const got = await enrichViaYcRecovery(
      { source: 'manual', company_name: 'Tell if AI' },
      {
        lookup: async () => ({ slug: 'tell-if-ai', name: 'Tell if AI' }),
        fetchFounders: async () => founders,
      },
    );
    expect(got).not.toBeNull();
    expect(got?.via).toBe('yc_detail');
    // Prefers the CEO over the first-listed CTO.
    expect(got?.linkedinUrl).toBe('https://linkedin.com/in/bo-ceo');
    expect(got?.role).toMatch(/ceo/i);
  });

  it('returns null when the Algolia name match is not confident (no YC company)', async () => {
    const got = await enrichViaYcRecovery(
      { source: 'manual', company_name: 'Totally Not A YC Co' },
      { lookup: async () => null, fetchFounders: async () => founders },
    );
    expect(got).toBeNull();
  });

  it('returns null when the recovered YC company has no founder LinkedIn', async () => {
    const got = await enrichViaYcRecovery(
      { source: 'manual', company_name: 'Tell if AI' },
      {
        lookup: async () => ({ slug: 'tell-if-ai', name: 'Tell if AI' }),
        fetchFounders: async () => [{ name: 'No Link', role: 'Founder' }],
      },
    );
    expect(got).toBeNull();
  });

  it('does not run recovery for a lead that already has a real YC slug (source yc_directory)', async () => {
    let called = false;
    const got = await enrichViaYcRecovery(
      { source: 'yc_directory', company_name: 'Acme' },
      {
        lookup: async () => {
          called = true;
          return { slug: 'acme', name: 'Acme' };
        },
        fetchFounders: async () => founders,
      },
    );
    expect(got).toBeNull();
    expect(called).toBe(false);
  });
});
