import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { fetchDirectoryLeads, isTinyFishConfigured } from '@/lib/signals/ingest/tinyfish-fetch';
import { SEED_DIRECTORY_LEADS } from '@/lib/signals/ingest/seed-leads';
import { decideContactStatus } from '@/lib/signals/leads/identity';

describe('Phase: Directory ingest (seed provider)', () => {
  const prevKey = process.env.TINYFISH_API_KEY;
  beforeEach(() => {
    delete process.env.TINYFISH_API_KEY;
  });
  afterEach(() => {
    if (prevKey !== undefined) process.env.TINYFISH_API_KEY = prevKey;
  });

  it('is not configured without an API key (seed path active)', () => {
    expect(isTinyFishConfigured()).toBe(false);
  });

  it('returns the YC seed set when TinyFish is unconfigured', async () => {
    const leads = await fetchDirectoryLeads('yc_directory');
    expect(leads.length).toBe(SEED_DIRECTORY_LEADS.filter((l) => l.source === 'yc_directory').length);
    expect(leads.every((l) => l.source === 'yc_directory')).toBe(true);
    expect(leads.every((l) => l.companyName && l.externalId)).toBe(true);
  });

  it('returns the Product Hunt seed set (Phase 9 source)', async () => {
    const leads = await fetchDirectoryLeads('product_hunt');
    expect(leads.length).toBe(SEED_DIRECTORY_LEADS.filter((l) => l.source === 'product_hunt').length);
    expect(leads.every((l) => l.source === 'product_hunt')).toBe(true);
  });

  it('seed mix produces both resolvable and no_contact leads (exercises every branch)', () => {
    const statuses = SEED_DIRECTORY_LEADS.map((l) =>
      decideContactStatus(
        (l.founders ?? []).map((f) => ({ linkedin_url: f.linkedinUrl ?? null, x_handle: f.xHandle ?? null, role: f.role ?? null })),
      ).status,
    );
    expect(statuses).toContain('resolved');
    expect(statuses).toContain('no_contact');
  });
});
