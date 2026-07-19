import { describe, it, expect } from 'vitest';
import { enrichViaSerperFounder } from '@/lib/signals/leads/enrich-contact';

type SerperRow = { link?: string; title?: string; snippet?: string };
const search = (rows: SerperRow[]) => async () => rows;

describe('enrichViaSerperFounder corroboration guard', () => {
  it('rejects an uncorroborated personal profile instead of using it for outreach', async () => {
    // A LinkedIn profile that mentions neither the domain nor the lead name.
    const got = await enrichViaSerperFounder(
      { company_name: 'Orbit Health', domain: 'orbithealth.com' },
      {
        search: search([
          { link: 'https://linkedin.com/in/random-stranger', title: 'Some Other Person', snippet: 'CEO at Unrelated Inc' },
        ]) as never,
      },
    );
    expect(got).toBeNull();
  });

  it('accepts a profile corroborated by the lead domain', async () => {
    const got = await enrichViaSerperFounder(
      { company_name: 'Orbit Health', domain: 'orbithealth.com' },
      {
        search: search([
          { link: 'https://linkedin.com/in/jane-doe', title: 'Jane Doe', snippet: 'Founder, orbithealth.com' },
        ]) as never,
      },
    );
    expect(got?.linkedinUrl).toBe('https://linkedin.com/in/jane-doe');
  });

  it('requires the domain when the lead has one, even if the name appears', async () => {
    // Name matches but domain does not: with a domain available it is the anchor.
    const got = await enrichViaSerperFounder(
      { company_name: 'Orbit Health', domain: 'orbithealth.com' },
      {
        search: search([
          { link: 'https://linkedin.com/in/imposter', title: 'Orbit Health fan page', snippet: 'no domain here' },
        ]) as never,
      },
    );
    expect(got).toBeNull();
  });

  it('falls back to name corroboration only when there is no domain', async () => {
    const got = await enrichViaSerperFounder(
      { company_name: 'Orbit Health', domain: null },
      {
        search: search([
          { link: 'https://linkedin.com/in/jane-doe', title: 'Jane Doe', snippet: 'Founder at Orbit Health' },
        ]) as never,
      },
    );
    expect(got?.linkedinUrl).toBe('https://linkedin.com/in/jane-doe');
  });

  it('returns null when the result set has no personal profile at all', async () => {
    const got = await enrichViaSerperFounder(
      { company_name: 'Orbit Health', domain: null },
      { search: search([{ link: 'https://orbithealth.com/about', snippet: 'Our team' }]) as never },
    );
    expect(got).toBeNull();
  });
});
