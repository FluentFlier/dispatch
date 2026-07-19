import { describe, it, expect } from 'vitest';
import {
  enrichViaSerperFounder,
  enrichViaUnipileExecutiveSearch,
  parseLinkedInProfileUrl,
} from '@/lib/signals/leads/enrich-contact';

describe('Phase: Serper + Unipile batch enrichment', () => {
  it('parses linkedin.com/in URLs from text', () => {
    expect(parseLinkedInProfileUrl('See https://www.linkedin.com/in/jane-doe at Acme')).toBe(
      'https://www.linkedin.com/in/jane-doe',
    );
    expect(parseLinkedInProfileUrl('no profile here')).toBeNull();
  });

  it('enrichViaSerperFounder extracts a profile from organic snippets', async () => {
    const got = await enrichViaSerperFounder(
      { company_name: 'Acme Robotics', domain: null },
      {
        search: async () => [
          {
            link: 'https://www.linkedin.com/in/jane-doe',
            title: 'Jane Doe - CEO at Acme Robotics',
            snippet: 'Founder of Acme Robotics',
          },
        ],
      },
    );
    expect(got?.linkedinUrl).toContain('linkedin.com/in/jane-doe');
    expect(got?.via).toBe('serper');
  });

  it('enrichViaUnipileExecutiveSearch returns CEO when headline matches', async () => {
    const got = await enrichViaUnipileExecutiveSearch('Acme Robotics', 'acct-1', {
      search: async () => ({
        name: 'Jane Doe',
        role: 'CEO & Co-founder at Acme Robotics',
        linkedinUrl: 'https://www.linkedin.com/in/jane-doe',
      }),
    });
    expect(got?.linkedinUrl).toContain('jane-doe');
    expect(got?.via).toBe('unipile');
  });

  it('enrichViaUnipileExecutiveSearch skips weak headline matches', async () => {
    const got = await enrichViaUnipileExecutiveSearch('Acme Robotics', 'acct-1', {
      search: async () => ({
        name: 'Random Person',
        role: 'Software Engineer at Other Co',
        linkedinUrl: 'https://www.linkedin.com/in/random',
      }),
    });
    expect(got).toBeNull();
  });
});
