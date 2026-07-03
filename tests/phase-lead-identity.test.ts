import { describe, it, expect } from 'vitest';
import {
  anchorKey,
  classifyLeadChange,
  companiesMatch,
  decideContactStatus,
  hasHardIntent,
  normalizeName,
  shouldResurface,
} from '@/lib/signals/leads/identity';

describe('Phase: Lead identity, rename & pivot (Q2 scenarios)', () => {
  // --- The core pain: companies rename/pivot and shouldn't be lost ---
  describe('classifyLeadChange', () => {
    const existing = { company_name: 'Acme Inc', tags: ['Fintech'], tagline: 'Payments API', name_history: [] };

    it('flags a rename when the name changes on the same anchor (auto-reconcile)', () => {
      const r = classifyLeadChange(existing, { companyName: 'Acme Pay', tags: ['Fintech'], tagline: 'Payments API' });
      expect(r.kind).toBe('renamed');
      expect(r.nameHistoryAdd).toBe('Acme Inc');
    });

    it('flags a pivot when tags/tagline shift but the name is stable', () => {
      const r = classifyLeadChange(existing, { companyName: 'Acme Inc', tags: ['AI', 'DevTools'], tagline: 'AI agents' });
      expect(r.kind).toBe('pivoted');
    });

    it('returns new when there is no existing row', () => {
      expect(classifyLeadChange(null, { companyName: 'Acme Inc' }).kind).toBe('new');
    });

    it('returns unchanged on an identical re-scrape', () => {
      const r = classifyLeadChange(existing, { companyName: 'Acme Inc', tags: ['Fintech'], tagline: 'Payments API' });
      expect(r.kind).toBe('unchanged');
    });

    it('treats a legal-suffix-only difference as unchanged, not a rename', () => {
      const r = classifyLeadChange(existing, { companyName: 'Acme, Inc.', tags: ['Fintech'], tagline: 'Payments API' });
      expect(r.kind).toBe('unchanged');
    });
  });

  describe('anchorKey (stable identity, never the name)', () => {
    it('prefers external_id, then domain, then normalized name', () => {
      expect(anchorKey({ externalId: 'yc-acme', domain: 'acme.com', companyName: 'Acme' })).toBe('ext:yc-acme');
      expect(anchorKey({ domain: 'acme.com', companyName: 'Acme' })).toBe('dom:acme.com');
      expect(anchorKey({ website: 'https://www.Acme.com/x', companyName: 'Acme' })).toBe('dom:acme.com');
      expect(anchorKey({ companyName: 'Acme Inc' })).toBe('name:acme');
    });

    it('a rename keeps the same anchor (follow/lead survives)', () => {
      const before = anchorKey({ externalId: 'yc-acme', companyName: 'Acme Inc' });
      const after = anchorKey({ externalId: 'yc-acme', companyName: 'Acme Pay' });
      expect(before).toBe(after);
    });
  });

  describe('companiesMatch (strict, no fuzzy)', () => {
    it('matches on equal external_id', () => {
      expect(companiesMatch({ externalId: 'x', companyName: 'A' }, { externalId: 'x', companyName: 'B' })).toBe(true);
    });
    it('matches a renamed company via stable domain', () => {
      expect(companiesMatch({ domain: 'acme.com', companyName: 'Acme Inc' }, { website: 'https://acme.com', companyName: 'Acme Pay' })).toBe(true);
    });
    it('does NOT cross-match similar names on different domains (false-positive guard)', () => {
      expect(companiesMatch({ domain: 'acme.io', companyName: 'Acme' }, { domain: 'acme.dev', companyName: 'Acme' })).toBe(false);
    });
    it('falls back to exact normalized name when no domains', () => {
      expect(companiesMatch({ companyName: 'Acme Inc' }, { companyName: 'Acme, Inc.' })).toBe(true);
    });
  });

  it('normalizeName strips legal suffixes and punctuation', () => {
    expect(normalizeName('Acme, Inc.')).toBe('acme');
    expect(normalizeName('Northwind LLC')).toBe('northwind');
  });
});

describe('Phase: Contact resolution decision', () => {
  it('resolves when a founder has a LinkedIn URL, preferring the CEO/Founder', () => {
    const d = decideContactStatus([
      { linkedin_url: null, x_handle: null, role: 'CTO' },
      { linkedin_url: 'https://linkedin.com/in/ceo', x_handle: null, role: 'CEO' },
    ]);
    expect(d.status).toBe('resolved');
    expect(d.primaryIndex).toBe(1);
    expect(d.via).toBe('scraped');
  });

  it('resolves on an X handle when no LinkedIn URL', () => {
    expect(decideContactStatus([{ linkedin_url: null, x_handle: '@founder', role: 'Founder' }]).status).toBe('resolved');
  });

  it('lands no_contact when no founder carries a usable identifier', () => {
    const d = decideContactStatus([{ linkedin_url: null, x_handle: null, role: 'Founder' }]);
    expect(d.status).toBe('no_contact');
    expect(d.primaryIndex).toBeNull();
  });

  it('picks the first resolvable when no CEO/Founder title present', () => {
    const d = decideContactStatus([
      { linkedin_url: null, x_handle: null, role: 'Ops' },
      { linkedin_url: 'https://linkedin.com/in/eng', x_handle: null, role: 'Engineer' },
    ]);
    expect(d.primaryIndex).toBe(1);
  });
});

describe('Phase: Reactivation policy (companies that change)', () => {
  it('resurfaces a dismissed lead on hard intent (raised funding)', () => {
    const r = shouldResurface({ leadStatus: 'dismissed', isFollowed: false, intentFlags: { raised: true }, gotIntentSignal: true });
    expect(r.resurface).toBe(true);
  });

  it('does NOT resurface a dismissed lead on a soft re-scrape (no intent signal)', () => {
    const r = shouldResurface({ leadStatus: 'dismissed', isFollowed: false, intentFlags: {}, gotIntentSignal: false });
    expect(r.resurface).toBe(false);
  });

  it('does NOT resurface a dismissed lead on soft intent only (hiring)', () => {
    const r = shouldResurface({ leadStatus: 'dismissed', isFollowed: false, intentFlags: { hiring: true }, gotIntentSignal: true });
    expect(r.resurface).toBe(false);
  });

  it('resurfaces a followed + dismissed company on hard intent (watchlist override)', () => {
    const r = shouldResurface({ leadStatus: 'dismissed', isFollowed: true, intentFlags: { seeking_investors: true }, gotIntentSignal: true });
    expect(r.resurface).toBe(true);
    expect(r.reason).toContain('followed');
  });

  it('resurfaces an active lead when any intent signal arrives', () => {
    expect(shouldResurface({ leadStatus: 'sent', isFollowed: false, intentFlags: { hiring: true }, gotIntentSignal: true }).resurface).toBe(true);
  });

  it('never resurfaces without an intent signal (no false positives)', () => {
    expect(shouldResurface({ leadStatus: 'new', isFollowed: true, intentFlags: {}, gotIntentSignal: false }).resurface).toBe(false);
  });

  it('hasHardIntent: raised/seeking_investors hard, hiring soft', () => {
    expect(hasHardIntent({ raised: true })).toBe(true);
    expect(hasHardIntent({ seeking_investors: true })).toBe(true);
    expect(hasHardIntent({ hiring: true })).toBe(false);
    expect(hasHardIntent({})).toBe(false);
  });
});
