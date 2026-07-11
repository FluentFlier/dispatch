import { describe, it, expect } from 'vitest';
import { enrichViaYcRecovery } from '@/lib/signals/leads/enrich-contact';
import type { YcFounder, YcNameMatch } from '@/lib/signals/ingest/yc-algolia';

/**
 * Golden accuracy set for YC-identity recovery (Track A / A1).
 *
 * GROUND TRUTH was established INDEPENDENTLY of our tool via web research — the
 * real decision-maker (CEO) of each ICP company and their LinkedIn — then we assert
 * the recovery pipeline returns the SAME person. This is the "did we find the same
 * lead a human researcher would" check, not just "did some URL come back".
 *
 * Sources (independent of the YC detail page the tool scrapes):
 *  - Boom AI      → Juan Casian (CEO, ex-Atrato YC W21)      linkedin.com/in/juancasian
 *  - Minimal AI   → Niek Hogenboom (Co-Founder & CEO)        linkedin.com/in/niek-hogenboom
 *  - Clicks       → Dominik Helmreich (CEO; NOT co-founder Oliver Knapp) linkedin.com/in/dominik-helmreich-30574a1b0
 *  - Soraban      → Enoch Ko (founder/CEO)                   linkedin.com/in/koenoch
 *  - AgentCollect → John Banner (Founder & CEO)              linkedin.com/in/johnbanr
 *
 * The `founders` arrays below are the live YC-detail founder lists (captured
 * 2026-07-08) in the exact shape fetchYcFounders returns, so the deterministic
 * suite exercises the real CEO-selection logic offline.
 */
interface GoldenCase {
  slug: string;
  company: string;
  expectedName: string;
  /** Substring the resolved linkedin_url must contain (the founder's profile slug). */
  expectedLinkedInIncludes: string;
  founders: YcFounder[];
}

const GOLDEN: GoldenCase[] = [
  {
    slug: 'boom-ai',
    company: 'Boom AI',
    expectedName: 'Juan Casian',
    expectedLinkedInIncludes: 'juancasian',
    founders: [
      { name: 'Juan Casian', role: 'CEO & Co-founder', linkedinUrl: 'https://www.linkedin.com/in/juancasian/' },
      { name: 'Sergio Garcia', role: 'Founder', linkedinUrl: 'https://www.linkedin.com/in/sergiogarciaglz/' },
      { name: 'Jose Toscano', role: 'CTO & Co-Founder', linkedinUrl: 'https://www.linkedin.com/in/josecarlostoscano/' },
    ],
  },
  {
    slug: 'minimal-ai',
    company: 'Minimal AI',
    expectedName: 'Niek Hogenboom',
    expectedLinkedInIncludes: 'niek-hogenboom',
    founders: [
      { name: 'Niek Hogenboom', role: 'Founder', linkedinUrl: 'https://www.linkedin.com/in/niek-hogenboom/' },
      { name: 'Titus Ex', role: 'Founder', linkedinUrl: 'https://linkedin.com/in/titus-ex-85691711a' },
    ],
  },
  {
    slug: 'clicks',
    company: 'Clicks',
    expectedName: 'Dominik Helmreich',
    expectedLinkedInIncludes: 'dominik-helmreich',
    founders: [
      { name: 'Dominik Helmreich', role: 'Founder', linkedinUrl: 'https://www.linkedin.com/in/dominik-helmreich-30574a1b0/' },
      { name: 'Oliver Knapp', role: 'Founder', linkedinUrl: 'https://www.linkedin.com/in/oliverkn/' },
    ],
  },
  {
    slug: 'soraban',
    company: 'Soraban',
    expectedName: 'Enoch Ko',
    expectedLinkedInIncludes: 'koenoch',
    founders: [
      { name: 'Enoch Ko', role: 'Founder/CEO', linkedinUrl: 'https://www.linkedin.com/in/koenoch/' },
    ],
  },
  {
    slug: 'agentcollect',
    company: 'AgentCollect',
    expectedName: 'John Banner',
    expectedLinkedInIncludes: 'johnbanr',
    founders: [
      { name: 'John Banner', role: 'Founder & CEO', linkedinUrl: 'https://linkedin.com/in/johnbanr' },
    ],
  },
];

describe('Phase: YC recovery accuracy vs independent research (deterministic)', () => {
  for (const g of GOLDEN) {
    it(`${g.company}: recovery returns the researched decision-maker (${g.expectedName})`, async () => {
      const lookup = async (): Promise<YcNameMatch> => ({ slug: g.slug, name: g.company });
      const fetchFounders = async (): Promise<YcFounder[]> => g.founders;

      const got = await enrichViaYcRecovery(
        { source: 'manual', company_name: g.company },
        { lookup, fetchFounders },
      );

      expect(got, `${g.company} should resolve to a contact`).not.toBeNull();
      expect(got?.name).toBe(g.expectedName);
      expect(got?.linkedinUrl?.toLowerCase()).toContain(g.expectedLinkedInIncludes);
    });
  }
});

/**
 * LIVE accuracy: runs the REAL recovery pipeline (Algolia name lookup + YC detail
 * scrape + CEO selection) against live YC and asserts it lands on the same LinkedIn
 * we found by hand. Network + YC-dependent, so gated behind RUN_LIVE_YC=1 to keep
 * CI hermetic. Run locally with: RUN_LIVE_YC=1 npx vitest run tests/phase-leads-yc-golden.test.ts
 */
describe.skipIf(!process.env.RUN_LIVE_YC)('Phase: YC recovery accuracy (LIVE against ycombinator.com)', () => {
  for (const g of GOLDEN) {
    it(`${g.company}: live recovery finds ${g.expectedLinkedInIncludes}`, async () => {
      const got = await enrichViaYcRecovery({ source: 'manual', company_name: g.company });
      expect(got, `${g.company} should resolve live`).not.toBeNull();
      expect(got?.linkedinUrl?.toLowerCase()).toContain(g.expectedLinkedInIncludes);
    }, 20_000);
  }
});
