/**
 * Phase: Niche Hooks - mining ingest filter primitives.
 * The 7-stage chain is cheapest-first (spec 2.3). Each primitive is pure and
 * carries punctuation-edge fixtures (Global Constraints: trailing '.' bugs).
 */
import { describe, it, expect } from 'vitest';
import { passesStructure, normEngagement, percentileRank, extractOpener, nearDupIndex } from '@/lib/hooks-intelligence/mining';

describe('passesStructure (filter 1)', () => {
  it('accepts a real post with a first line and sane length', () => {
    expect(passesStructure('I rebuilt our onboarding in a weekend.\n\nHere is what changed and why it worked.')).toBe(true);
  });
  it('rejects too-short and empty', () => {
    expect(passesStructure('hi')).toBe(false);
    expect(passesStructure('   ')).toBe(false);
  });
  it('rejects a 4000-char wall', () => {
    expect(passesStructure('a. '.repeat(1400))).toBe(false);
  });
});

describe('normEngagement (filter 3)', () => {
  it('weights comments 3x and normalizes by followers', () => {
    // ln(1 + 10 + 3*5) - ln(1 + 1000)
    expect(normEngagement(10, 5, 1000)).toBeCloseTo(Math.log(26) - Math.log(1001), 6);
  });
  it('is higher for the same likes with more comments', () => {
    expect(normEngagement(10, 20, 1000)).toBeGreaterThan(normEngagement(10, 0, 1000));
  });
});

describe('percentileRank', () => {
  it('returns 0..1 rank within a batch', () => {
    expect(percentileRank(5, [1, 2, 3, 4, 5])).toBeCloseTo(1, 6);
    expect(percentileRank(1, [1, 2, 3, 4, 5])).toBeCloseTo(0.2, 6);
  });
  it('handles a single-element batch', () => {
    expect(percentileRank(3, [3])).toBe(1);
  });
});

describe('extractOpener (filter 5 helper)', () => {
  it('takes the first line and strips a trailing period', () => {
    expect(extractOpener('I made $12k in a week.\n\nThen it stopped.')).toBe('I made $12k in a week');
  });
  it('strips a trailing ellipsis and quote', () => {
    expect(extractOpener('Nobody tells you this...')).toBe('Nobody tells you this');
    expect(extractOpener('"Just ship it," they said.')).toBe('"Just ship it," they said');
  });
  it('falls back to a sentence when there is no newline', () => {
    expect(extractOpener('One line only, no breaks here. Second sentence.')).toBe('One line only, no breaks here');
  });
});

describe('nearDupIndex (filter 6)', () => {
  const a = [1, 0, 0];
  const b = [0.99, 0.14, 0];
  const c = [0, 1, 0];
  it('finds a near-duplicate above threshold', () => {
    expect(nearDupIndex(a, [c, b], 0.92)).toBe(1);
  });
  it('returns -1 when nothing is close', () => {
    expect(nearDupIndex(a, [c], 0.92)).toBe(-1);
  });
});
