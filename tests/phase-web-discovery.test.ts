import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mapExtractedToLeads,
  parseExtractedCompanies,
  isWebDiscoveryConfigured,
  isSerperWebDiscoveryConfigured,
  discoverWebLeads,
} from '@/lib/signals/ingest/lead-sources/web-discovery';

describe('Phase: web discovery', () => {
  it('parses LLM JSON into company rows', () => {
    const raw = JSON.stringify({
      companies: [
        {
          company_name: 'Acme Dental',
          website: 'https://acmedental.com',
          tagline: 'Modern practice management',
          tags: ['Healthcare', 'Ohio'],
        },
      ],
    });
    const rows = parseExtractedCompanies(raw);
    expect(rows).toHaveLength(1);
    const leads = mapExtractedToLeads(rows);
    expect(leads[0]).toMatchObject({
      source: 'web_discovery',
      companyName: 'Acme Dental',
      website: 'https://acmedental.com',
      tagline: 'Modern practice management',
    });
    expect(leads[0].externalId).toContain('web-acme-dental');
  });

  it('dedupes by domain', () => {
    const leads = mapExtractedToLeads([
      { company_name: 'Acme', website: 'https://acme.com' },
      { company_name: 'Acme Inc', website: 'https://acme.com/about' },
    ]);
    expect(leads).toHaveLength(1);
  });

  describe('configuration', () => {
    const prevSerper = process.env.SERPER_API_KEY;
    const prevTiny = process.env.TINYFISH_API_KEY;
    const prevLlm = process.env.LLM_API_KEY;
    const prevHf = process.env.HUGGINGFACE_API_KEY;

    beforeEach(() => {
      delete process.env.SERPER_API_KEY;
      delete process.env.TINYFISH_API_KEY;
      delete process.env.LLM_API_KEY;
      process.env.HUGGINGFACE_API_KEY = 'hf-test';
    });
    afterEach(() => {
      if (prevSerper !== undefined) process.env.SERPER_API_KEY = prevSerper;
      else delete process.env.SERPER_API_KEY;
      if (prevTiny !== undefined) process.env.TINYFISH_API_KEY = prevTiny;
      else delete process.env.TINYFISH_API_KEY;
      if (prevLlm !== undefined) process.env.LLM_API_KEY = prevLlm;
      else delete process.env.LLM_API_KEY;
      if (prevHf !== undefined) process.env.HUGGINGFACE_API_KEY = prevHf;
      else delete process.env.HUGGINGFACE_API_KEY;
    });

    it('isWebDiscoveryConfigured with TinyFish + LLM when Serper absent', () => {
      process.env.TINYFISH_API_KEY = 'tf-test';
      expect(isWebDiscoveryConfigured()).toBe(true);
      expect(isSerperWebDiscoveryConfigured()).toBe(false);
    });

    it('discoverWebLeads uses TinyFish fallback when Serper absent', async () => {
      process.env.TINYFISH_API_KEY = 'tf-test';
      const leads = await discoverWebLeads(
        {
          icpDescription: 'B2B dental SaaS',
          icpVerticals: [],
          icpKeywords: [],
          icpQuery: 'B2B dental SaaS',
          maxLeads: 10,
        },
        {
          tinyfishDiscover: async () => [
            {
              source: 'web_discovery',
              externalId: 'web-acme-dental',
              companyName: 'Acme Dental',
              website: 'https://acmedental.com',
              tags: [],
              founders: [],
            },
          ],
        },
      );
      expect(leads).toHaveLength(1);
      expect(leads[0].companyName).toBe('Acme Dental');
    });
  });
});
