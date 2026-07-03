import { describe, it, expect } from 'vitest';
import { computeFitScore, computeRankScore } from '@/lib/signals/leads/score';
import { normalizeDomain } from '@/lib/signals/leads/store';

describe('Phase: Directory Lead Engine', () => {
  describe('normalizeDomain (stable identity anchor)', () => {
    it('strips protocol, www, path and lowercases', () => {
      expect(normalizeDomain('https://www.Acme.com/careers')).toBe('acme.com');
      expect(normalizeDomain('acme.com')).toBe('acme.com');
    });
    it('collapses variants of the same company to one anchor (survives rename)', () => {
      expect(normalizeDomain('http://WWW.Acme.com')).toBe(normalizeDomain('https://acme.com/x'));
    });
    it('returns null for empty/garbage', () => {
      expect(normalizeDomain(null)).toBeNull();
      expect(normalizeDomain('')).toBeNull();
    });
  });

  describe('computeFitScore (ICP match)', () => {
    const lead = { tags: ['Fintech', 'Compliance'], tagline: 'Compliance automation', company_name: 'Northwind' };
    it('scores an exact vertical match above a tangential one', () => {
      const strong = computeFitScore(lead, { icp_verticals: ['fintech'], icp_keywords: [] });
      const weak = computeFitScore(lead, { icp_verticals: ['logistics'], icp_keywords: [] });
      expect(strong).toBeGreaterThan(weak);
    });
    it('returns neutral 0.5 when no ICP is configured', () => {
      expect(computeFitScore(lead, { icp_verticals: [], icp_keywords: [] })).toBe(0.5);
    });
    it('is deterministic (no RNG)', () => {
      const a = computeFitScore(lead, { icp_verticals: ['fintech'], icp_keywords: ['compliance'] });
      const b = computeFitScore(lead, { icp_verticals: ['fintech'], icp_keywords: ['compliance'] });
      expect(a).toBe(b);
    });
  });

  describe('computeRankScore', () => {
    const today = '2026-07-02';
    it('ranks a fresh-today lead above an identical older one', () => {
      const base = { intent_flags: {}, contact_status: 'resolved' as const };
      const fresh = computeRankScore({ ...base, digest_date: today }, 0.5, today);
      const old = computeRankScore({ ...base, digest_date: '2026-06-01' }, 0.5, today);
      expect(fresh).toBeGreaterThan(old);
    });
    it('penalizes no_contact leads so actionable ones float up', () => {
      const actionable = computeRankScore({ intent_flags: {}, contact_status: 'resolved', digest_date: today }, 0.5, today);
      const dead = computeRankScore({ intent_flags: {}, contact_status: 'no_contact', digest_date: today }, 0.5, today);
      expect(actionable).toBeGreaterThan(dead);
    });
    it('boosts leads with raised-funding intent (reactivation)', () => {
      const plain = computeRankScore({ intent_flags: {}, contact_status: 'resolved', digest_date: today }, 0.5, today);
      const raised = computeRankScore({ intent_flags: { raised: true }, contact_status: 'resolved', digest_date: today }, 0.5, today);
      expect(raised).toBeGreaterThan(plain);
    });
  });
});
