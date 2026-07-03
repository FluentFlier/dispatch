import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { withComplianceFooter } from '@/lib/signals/outreach/send-lead';
import { enrichFounderContact } from '@/lib/signals/leads/enrich-contact';
import { DEFAULT_SAFETY_SETTINGS, channelToLimitKey } from '@/lib/signals/safety/limits';

describe('Phase 9: cold-email compliance + safety', () => {
  describe('withComplianceFooter', () => {
    it('always appends an unsubscribe line', () => {
      const out = withComplianceFooter('Hi there, quick question.');
      expect(out).toContain('Hi there, quick question.');
      expect(out.toLowerCase()).toContain('unsubscribe');
    });

    it('includes sender identity when configured', () => {
      const prev = process.env.OUTREACH_SENDER_IDENTITY;
      process.env.OUTREACH_SENDER_IDENTITY = 'Acme GTM, 1 Main St';
      expect(withComplianceFooter('Hey')).toContain('Acme GTM, 1 Main St');
      if (prev === undefined) delete process.env.OUTREACH_SENDER_IDENTITY;
      else process.env.OUTREACH_SENDER_IDENTITY = prev;
    });
  });

  describe('Gmail rate cap', () => {
    it('has a conservative daily Gmail cap default (sender-reputation guard)', () => {
      expect(DEFAULT_SAFETY_SETTINGS.max_gmail_per_day).toBe(20);
    });
    it('routes gmail to its own limit key', () => {
      expect(channelToLimitKey('gmail')).toBe('gmail');
    });
  });
});

describe('Phase 3: enrichment ladder gating', () => {
  const prev = {
    tf: process.env.TINYFISH_API_KEY,
    tok: process.env.APIFY_TOKEN,
    actor: process.env.APIFY_LINKEDIN_PROFILE_ACTOR,
  };
  beforeEach(() => {
    delete process.env.TINYFISH_API_KEY;
    delete process.env.APIFY_TOKEN;
    delete process.env.APIFY_LINKEDIN_PROFILE_ACTOR;
  });
  afterEach(() => {
    Object.assign(process.env, {
      ...(prev.tf !== undefined ? { TINYFISH_API_KEY: prev.tf } : {}),
      ...(prev.tok !== undefined ? { APIFY_TOKEN: prev.tok } : {}),
      ...(prev.actor !== undefined ? { APIFY_LINKEDIN_PROFILE_ACTOR: prev.actor } : {}),
    });
  });

  it('returns null (no enrichment) when neither provider is configured', async () => {
    const result = await enrichFounderContact({
      company_name: 'Flux Labs',
      website: 'https://fluxlabs.ai',
      contacts: [],
    });
    expect(result).toBeNull();
  });
});
