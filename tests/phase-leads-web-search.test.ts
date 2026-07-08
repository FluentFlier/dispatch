import { describe, it, expect } from 'vitest';
import { enrichViaWebSearch } from '@/lib/signals/leads/enrich-contact';

/**
 * Track B: universal LLM web-search founder rung. Works for any non-YC source
 * (arbitrary website, X, non-YC ICP) from just the company name. The reply is
 * strict JSON; only a personal linkedin.com/in/ URL counts. The `complete` fn is
 * injected so these run without a live LLM.
 */
describe('Phase: LLM web-search founder rung', () => {
  it('returns a contact when the LLM yields a personal LinkedIn URL', async () => {
    const complete = async () =>
      '{"name":"Jane Doe","role":"Co-Founder & CEO","linkedin_url":"https://www.linkedin.com/in/jane-doe/"}';
    const got = await enrichViaWebSearch({ company_name: 'Acme Robotics' }, { complete });
    expect(got).not.toBeNull();
    expect(got?.via).toBe('web_search');
    expect(got?.name).toBe('Jane Doe');
    expect(got?.linkedinUrl).toContain('/in/jane-doe');
  });

  it('parses JSON even when the model wraps it in prose', async () => {
    const complete = async () =>
      'Here is what I found:\n{"name":"Bo Lee","role":"Founder","linkedin_url":"https://linkedin.com/in/bolee"}\nHope that helps.';
    const got = await enrichViaWebSearch({ company_name: 'BoCo' }, { complete });
    expect(got?.linkedinUrl).toBe('https://linkedin.com/in/bolee');
  });

  it('rejects a company page URL (not messageable)', async () => {
    const complete = async () =>
      '{"name":null,"role":null,"linkedin_url":"https://www.linkedin.com/company/acme"}';
    expect(await enrichViaWebSearch({ company_name: 'Acme' }, { complete })).toBeNull();
  });

  it('returns null when the model is not confident (null url)', async () => {
    const complete = async () => '{"name":null,"role":null,"linkedin_url":null}';
    expect(await enrichViaWebSearch({ company_name: 'Unknown Co' }, { complete })).toBeNull();
  });

  it('returns null on non-JSON output', async () => {
    const complete = async () => "I couldn't find the founder.";
    expect(await enrichViaWebSearch({ company_name: 'Ghost Co' }, { complete })).toBeNull();
  });

  it('degrades to null when the LLM call throws (unconfigured / budget-capped)', async () => {
    const complete = async () => {
      throw new Error('LLM budget reached');
    };
    expect(await enrichViaWebSearch({ company_name: 'Acme' }, { complete })).toBeNull();
  });

  it('returns null with no company name', async () => {
    const complete = async () => '{"linkedin_url":"https://linkedin.com/in/x"}';
    expect(await enrichViaWebSearch({ company_name: '' }, { complete })).toBeNull();
  });

  it('is inert (returns null) when no web-search model is configured and no LLM is injected', async () => {
    // LLM_WEBSEARCH_MODEL is unset in the test env → the rung must not call the LLM.
    expect(process.env.LLM_WEBSEARCH_MODEL).toBeFalsy();
    expect(await enrichViaWebSearch({ company_name: 'Acme Robotics' })).toBeNull();
  });
});
