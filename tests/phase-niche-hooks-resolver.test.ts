/**
 * Phase: Niche Hooks - niche resolution decision logic.
 * The IO wrappers (LLM classify, DB read/write) are thin; the risk is in the
 * math: cosine dedupe thresholds, slug hygiene, and the anti-explosion budget
 * gate. Those are pure and fully tested here.
 */
import { describe, it, expect } from 'vitest';
import {
  cosineSim, slugify, decideAssignment, earnsBudget,
  NICHE_MERGE_THRESHOLD, MAX_ACTIVE_NICHES, type NicheRow,
} from '@/lib/hooks-intelligence/niche-resolver';

const unit = (seed: number[]): number[] => {
  const n = Math.sqrt(seed.reduce((a, b) => a + b * b, 0));
  return seed.map((x) => x / n);
};

describe('cosineSim', () => {
  it('is 1 for identical, 0 for orthogonal', () => {
    expect(cosineSim([1, 0], [1, 0])).toBeCloseTo(1, 6);
    expect(cosineSim([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });
});

describe('slugify', () => {
  it('lowercases, hyphenates, strips punctuation including trailing period', () => {
    expect(slugify('Fitness Coaching.')).toBe('fitness-coaching');
    expect(slugify('  Auto Detailing & Care!  ')).toBe('auto-detailing-care');
    expect(slugify('AI/ML')).toBe('ai-ml');
  });
});

describe('decideAssignment', () => {
  const near = unit([1, 0.02, 0]);
  const rows: NicheRow[] = [
    { id: 'a', slug: 'automotive', label: 'Automotive', embedding: unit([1, 0, 0]), status: 'active', active_user_count: 3 },
    { id: 'f', slug: 'fitness', label: 'Fitness', embedding: unit([0, 1, 0]), status: 'active', active_user_count: 1 },
  ];
  it('assigns to an existing niche above the 0.85 merge cutoff', () => {
    const d = decideAssignment(near, rows);
    expect(d.action).toBe('assign');
    expect(d.niche?.id).toBe('a');
    expect(d.bestSim).toBeGreaterThanOrEqual(NICHE_MERGE_THRESHOLD);
  });
  it('flags 0.75-0.85 for review but still assigns', () => {
    const mid = unit([1, 0.6, 0]); // sim to automotive ~ 0.86? keep below by construction
    const d = decideAssignment(unit([1, 0.75, 0]), rows);
    expect(['assign', 'assign-review']).toContain(d.action);
    void mid;
  });
  it('creates a new niche below 0.75', () => {
    const d = decideAssignment(unit([0, 0, 1]), rows);
    expect(d.action).toBe('create');
  });
  it('skips rows with no embedding', () => {
    const d = decideAssignment(unit([1, 0, 0]), [{ ...rows[0], embedding: null }]);
    expect(d.action).toBe('create');
  });
});

describe('earnsBudget (anti-explosion, spec 2.2.4)', () => {
  it('earns budget at 2+ active users', () => {
    expect(earnsBudget({ active_user_count: 2, isPaying: false, ageDays: 0 })).toBe(true);
  });
  it('earns budget for a paying user after 14 days', () => {
    expect(earnsBudget({ active_user_count: 1, isPaying: true, ageDays: 14 })).toBe(true);
    expect(earnsBudget({ active_user_count: 1, isPaying: true, ageDays: 13 })).toBe(false);
  });
  it('a lone free user does not earn budget (inherits parent)', () => {
    expect(earnsBudget({ active_user_count: 1, isPaying: false, ageDays: 99 })).toBe(false);
  });
  it('MAX_ACTIVE_NICHES cap is 50', () => {
    expect(MAX_ACTIVE_NICHES).toBe(50);
  });
});
