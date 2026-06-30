import { describe, it, expect } from 'vitest';
import {
  normalizePillarSlug,
  clampWeight,
  postPillars,
  pillarWeights,
  weightedPillars,
  normalizePillars,
  profilePillarWeights,
  DEFAULT_PILLAR_WEIGHT,
} from '@/lib/pillars';

/**
 * Phase 1: pillar weighting + slug normalization foundation.
 * Covers the helper layer every downstream surface (UI, analytics, AI) relies on.
 */
describe('Phase: Pillar Weights — helpers', () => {
  describe('normalizePillarSlug', () => {
    it('canonicalizes underscore and whitespace variants to one slug', () => {
      expect(normalizePillarSlug('hot_take')).toBe('hot-take');
      expect(normalizePillarSlug('Hot Take')).toBe('hot-take');
      expect(normalizePillarSlug('  HOT__take  ')).toBe('hot-take');
      expect(normalizePillarSlug('hot-take')).toBe('hot-take');
    });
  });

  describe('clampWeight', () => {
    it('clamps to 1-100 and defaults non-numbers', () => {
      expect(clampWeight(50)).toBe(50);
      expect(clampWeight(0)).toBe(1);
      expect(clampWeight(150)).toBe(100);
      expect(clampWeight(73.6)).toBe(74);
      expect(clampWeight('nope' as unknown)).toBe(DEFAULT_PILLAR_WEIGHT);
      expect(clampWeight(undefined)).toBe(DEFAULT_PILLAR_WEIGHT);
    });
  });

  describe('postPillars', () => {
    it('prefers pillars[], falls back to [pillar], normalizes + de-dupes', () => {
      expect(postPillars({ pillars: ['hot_take', 'Hot Take', 'ai'] })).toEqual(['hot-take', 'ai']);
      expect(postPillars({ pillar: 'founder' })).toEqual(['founder']);
      expect(postPillars({ pillar: null, pillars: null })).toEqual([]);
    });
  });

  describe('pillarWeights', () => {
    it('canonicalizes keys and clamps values', () => {
      expect(pillarWeights({ pillar_weights: { hot_take: 90, ai: 200 } })).toEqual({
        'hot-take': 90,
        ai: 100,
      });
      expect(pillarWeights({ pillar_weights: null })).toEqual({});
    });
  });

  describe('weightedPillars', () => {
    it('sorts by weight desc, ties keep original order', () => {
      const result = weightedPillars({
        pillars: ['ai', 'career', 'hot-take'],
        pillar_weights: { ai: 40, career: 40, 'hot-take': 90 },
      });
      expect(result).toEqual([
        { slug: 'hot-take', weight: 90 },
        { slug: 'ai', weight: 40 },
        { slug: 'career', weight: 40 },
      ]);
    });

    it('falls back to profile weights then default for missing weights', () => {
      const result = weightedPillars(
        { pillars: ['ai', 'career'] },
        { ai: 80 },
      );
      expect(result).toEqual([
        { slug: 'ai', weight: 80 },
        { slug: 'career', weight: DEFAULT_PILLAR_WEIGHT },
      ]);
    });
  });

  describe('normalizePillars', () => {
    it('orders primary-first by weight and keeps pillar = highest weight', () => {
      const out = normalizePillars({
        pillars: ['ai', 'hot-take'],
        pillar_weights: { ai: 30, 'hot-take': 80 },
      });
      expect(out.pillar).toBe('hot-take');
      expect(out.pillars).toEqual(['hot-take', 'ai']);
      expect(out.pillar_weights).toEqual({ 'hot-take': 80, ai: 30 });
    });

    it('accepts legacy single pillar and defaults its weight', () => {
      const out = normalizePillars({ pillar: 'founder' });
      expect(out.pillar).toBe('founder');
      expect(out.pillars).toEqual(['founder']);
      expect(out.pillar_weights).toEqual({ founder: DEFAULT_PILLAR_WEIGHT });
    });

    it('never returns empty — falls back to general', () => {
      const out = normalizePillars({ pillar: null, pillars: [] });
      expect(out.pillar).toBe('general');
      expect(out.pillars).toEqual(['general']);
    });

    it('canonicalizes + de-dupes underscore variants on write', () => {
      const out = normalizePillars({ pillars: ['hot_take', 'Hot Take', 'ai'] });
      expect(out.pillars).toEqual(['hot-take', 'ai']);
    });
  });

  describe('profilePillarWeights', () => {
    it('slugifies names and clamps weights from profile config', () => {
      expect(
        profilePillarWeights([
          { name: 'Artificial Intelligence', weight: 80 },
          { name: 'Hot Take' },
        ]),
      ).toEqual({ 'artificial-intelligence': 80, 'hot-take': DEFAULT_PILLAR_WEIGHT });
      expect(profilePillarWeights(null)).toEqual({});
    });
  });
});
