/**
 * Phase: Leads quality 2 - Task 1
 *
 * The contact-resolution ladder's rung 4 (Unipile LinkedIn people-search) was
 * a null stub. This locks in the real search call (account-scoped, fail-closed)
 * and the enrichment path that threads a workspace-resolved account id into it.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

vi.mock('@/lib/signals/outreach/unipile-client', () => ({
  unipileJsonPost: vi.fn(),
  unipileJsonGet: vi.fn(),
  unipileFormPost: vi.fn(),
  parseUnipileError: vi.fn(async () => 'error'),
  getLinkedInApiMode: vi.fn(() => 'classic'),
}));

import { unipileJsonPost } from '@/lib/signals/outreach/unipile-client';
import { searchLinkedInPerson } from '@/lib/signals/outreach/unipile-linkedin';
import { enrichViaUnipileSearch } from '@/lib/signals/leads/enrich-contact';

beforeAll(() => {
  process.env.UNIPILE_DSN = 'api1.unipile.com:1234';
  process.env.UNIPILE_API_KEY = 'test-key';
});

beforeEach(() => vi.clearAllMocks());

describe('Phase: Leads quality 2 - Unipile people-search rung', () => {
  describe('searchLinkedInPerson', () => {
    it('maps the first PEOPLE item to linkedinUrl + name on a 2xx response', async () => {
      vi.mocked(unipileJsonPost).mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [
              {
                type: 'PEOPLE',
                id: 'abc',
                name: 'Jordan Kim',
                profile_url: 'https://www.linkedin.com/in/jordankim',
                headline: 'Founder at Acme',
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      );

      const result = await searchLinkedInPerson({
        name: 'Jordan Kim',
        company: 'Acme',
        accountId: 'acc_123',
      });

      expect(result).toEqual({
        name: 'Jordan Kim',
        role: 'Founder at Acme',
        linkedinUrl: 'https://www.linkedin.com/in/jordankim',
      });

      const [path, body] = vi.mocked(unipileJsonPost).mock.calls[0];
      expect(String(path)).toContain('/linkedin/search');
      expect(String(path)).toContain('account_id=acc_123');
      expect(body).toEqual({
        api: 'classic',
        category: 'people',
        keywords: 'Jordan Kim Acme',
      });
    });

    it('returns null without calling the HTTP helper when accountId is empty', async () => {
      const result = await searchLinkedInPerson({ name: 'Jordan Kim', company: 'Acme', accountId: '' });
      expect(result).toBeNull();
      expect(unipileJsonPost).not.toHaveBeenCalled();
    });

    it('returns null (fail-closed) on a non-2xx response', async () => {
      vi.mocked(unipileJsonPost).mockResolvedValue(
        new Response(JSON.stringify({ detail: 'nope' }), { status: 400 }),
      );

      const result = await searchLinkedInPerson({
        name: 'Jordan Kim',
        company: 'Acme',
        accountId: 'acc_123',
      });

      expect(result).toBeNull();
    });

    it('returns null when there are no people items', async () => {
      vi.mocked(unipileJsonPost).mockResolvedValue(
        new Response(JSON.stringify({ items: [] }), { status: 200 }),
      );

      const result = await searchLinkedInPerson({
        name: 'Jordan Kim',
        company: 'Acme',
        accountId: 'acc_123',
      });

      expect(result).toBeNull();
    });
  });

  describe('enrichViaUnipileSearch', () => {
    it('returns null when there is no founder name (unchanged behavior)', async () => {
      const search = vi.fn();
      const result = await enrichViaUnipileSearch({ companyName: 'Acme', founderName: null }, { search });
      expect(result).toBeNull();
      expect(search).not.toHaveBeenCalled();
    });

    it('returns the found contact when the injected search yields one', async () => {
      const search = vi.fn().mockResolvedValue({
        name: 'Jordan Kim',
        role: 'Founder',
        linkedinUrl: 'https://www.linkedin.com/in/jordankim',
      });
      const result = await enrichViaUnipileSearch(
        { companyName: 'Acme', founderName: 'Jordan Kim' },
        { search },
      );
      expect(result).toEqual({
        name: 'Jordan Kim',
        role: 'Founder',
        linkedinUrl: 'https://www.linkedin.com/in/jordankim',
        via: 'unipile',
      });
      expect(search).toHaveBeenCalledWith({ name: 'Jordan Kim', company: 'Acme' });
    });
  });
});
