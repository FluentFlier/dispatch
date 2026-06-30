import { describe, it, expect } from 'vitest';
import { normalizePillars, postPillars } from '@/lib/pillars';

/**
 * Phase B: multiple pillars per post. The primary `pillar` must always stay in
 * sync as pillars[0] so legacy readers keep working.
 */
describe('normalizePillars', () => {
  it('keeps the array and sets primary to the first (equal weights keep order)', () => {
    expect(normalizePillars({ pillars: ['ai', 'asu'] })).toEqual({
      pillar: 'ai',
      pillars: ['ai', 'asu'],
      pillar_weights: { ai: 50, asu: 50 },
    });
  });

  it('trims and de-dupes', () => {
    expect(normalizePillars({ pillars: [' ai ', 'ai', '', 'asu'] })).toEqual({
      pillar: 'ai',
      pillars: ['ai', 'asu'],
      pillar_weights: { ai: 50, asu: 50 },
    });
  });

  it('promotes a legacy single pillar to an array', () => {
    expect(normalizePillars({ pillar: 'tech' })).toEqual({
      pillar: 'tech',
      pillars: ['tech'],
      pillar_weights: { tech: 50 },
    });
  });

  it('prefers the array over a stray single pillar', () => {
    expect(normalizePillars({ pillar: 'x', pillars: ['y', 'z'] })).toEqual({
      pillar: 'y',
      pillars: ['y', 'z'],
      pillar_weights: { y: 50, z: 50 },
    });
  });

  it('falls back to general when nothing is provided', () => {
    expect(normalizePillars({})).toEqual({
      pillar: 'general',
      pillars: ['general'],
      pillar_weights: { general: 50 },
    });
  });
});

describe('postPillars', () => {
  it('returns the array when present', () => {
    expect(postPillars({ pillar: 'ai', pillars: ['ai', 'asu'] })).toEqual(['ai', 'asu']);
  });

  it('falls back to [pillar] for legacy rows', () => {
    expect(postPillars({ pillar: 'ai' })).toEqual(['ai']);
    expect(postPillars({ pillar: 'ai', pillars: [] })).toEqual(['ai']);
  });

  it('returns [] when there is nothing', () => {
    expect(postPillars({})).toEqual([]);
  });
});
