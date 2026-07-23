import { describe, expect, it, vi } from 'vitest';
import { MAX_ICP_KEYWORDS, normalizeIcpTerms } from '@/lib/signals/leads/icp-limits';
import { inferPersonaTarget, roleFitsPersona } from '@/lib/signals/leads/persona-fit';
import { enrichFounderContact, enrichViaPersonaSearch } from '@/lib/signals/leads/enrich-contact';

describe('ICP keyword contract', () => {
  it('keeps up to the documented limit and de-duplicates without changing order', () => {
    const terms = Array.from({ length: MAX_ICP_KEYWORDS + 3 }, (_, i) => `keyword ${i}`);
    expect(normalizeIcpTerms([...terms, 'KEYWORD 0'], MAX_ICP_KEYWORDS)).toEqual(
      terms.slice(0, MAX_ICP_KEYWORDS),
    );
  });
});

describe('person-level ICP fit', () => {
  it('recognizes an individual-contributor UX researcher target', () => {
    const target = inferPersonaTarget('Individual contributor UX researchers at B2B SaaS companies');
    expect(target).toEqual({ query: 'UX researchers', excludeExecutives: true });
    expect(roleFitsPersona('Senior UX Researcher', target!)).toBe(true);
    expect(roleFitsPersona('Founder & CEO', target!)).toBe(false);
  });

  it('does not infer a person target from a company ICP that mentions a role', () => {
    expect(inferPersonaTarget('B2B SaaS companies hiring UX researchers')).toBeNull();
    expect(inferPersonaTarget('UX research software companies')).toBeNull();
  });

  it('does not perform remote persona enrichment in the fast batch path', async () => {
    const target = inferPersonaTarget('individual contributor UX researchers')!;
    const unusableClient = new Proxy({}, {
      get() {
        throw new Error('remote lookup should not be reached');
      },
    });
    await expect(enrichFounderContact({
      source: 'web_discovery',
      external_id: 'lead-1',
      company_name: 'Acme',
      domain: 'acme.test',
      website: 'https://acme.test',
      contacts: [],
    }, {
      fastOnly: true,
      persona: target,
      client: unusableClient as never,
      workspaceId: 'workspace-1',
    })).resolves.toBeNull();
  });

  it('accepts only a matching LinkedIn person result instead of an executive', async () => {
    const target = inferPersonaTarget('individual contributor UX researchers')!;
    const executiveSearch = vi.fn().mockResolvedValue({
      name: 'Alex', role: 'Founder & CEO', linkedinUrl: 'https://linkedin.com/in/alex',
    });
    await expect(
      enrichViaPersonaSearch({ company_name: 'Acme' }, target, 'account-1', { search: executiveSearch }),
    ).resolves.toBeNull();

    const researcherSearch = vi.fn().mockResolvedValue({
      name: 'Rae', role: 'Senior UX Researcher', linkedinUrl: 'https://linkedin.com/in/rae',
    });
    await expect(
      enrichViaPersonaSearch({ company_name: 'Acme' }, target, 'account-1', { search: researcherSearch }),
    ).resolves.toMatchObject({ name: 'Rae', role: 'Senior UX Researcher' });
  });
});
