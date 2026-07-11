/**
 * Phase: Niche Hooks - Beta-Bernoulli Thompson sampling.
 * Hand-rolled Beta via two Marsaglia-Tsang Gamma draws. Deterministic under a
 * seeded RNG so tests never flake. This is the selection authority over arms.
 */
import { describe, it, expect } from 'vitest';
import { sampleBeta, sampleTheta, pickTopK, updateArm, priorAlpha, type Arm } from '@/lib/hooks-intelligence/thompson';

/** Seeded PRNG (mulberry32) - deterministic, uniform in [0,1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('sampleBeta', () => {
  it('is reproducible for a fixed seed', () => {
    expect(sampleBeta(2, 5, mulberry32(42))).toBe(sampleBeta(2, 5, mulberry32(42)));
  });
  it('stays within (0,1)', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 200; i++) {
      const x = sampleBeta(3, 4, rng);
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(1);
    }
  });
  it('orders by prior mass: Beta(8,2) > Beta(2,8) on average', () => {
    const rng = mulberry32(123);
    const hi = Array.from({ length: 400 }, () => sampleBeta(8, 2, rng));
    const lo = Array.from({ length: 400 }, () => sampleBeta(2, 8, rng));
    expect(mean(hi)).toBeGreaterThan(mean(lo) + 0.2);
  });
  it('handles alpha or beta below 1 (boost branch) without NaN', () => {
    const rng = mulberry32(9);
    for (let i = 0; i < 100; i++) {
      const x = sampleBeta(0.5, 0.5, rng);
      expect(Number.isFinite(x)).toBe(true);
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(1);
    }
  });
  // Extra edge-case coverage per task global constraints (not in brief verbatim block above).
  it('handles extreme arms (alpha=100, beta=1) without NaN, skewed near 1', () => {
    const rng = mulberry32(11);
    const draws = Array.from({ length: 200 }, () => sampleBeta(100, 1, rng));
    for (const x of draws) {
      expect(Number.isFinite(x)).toBe(true);
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(1);
    }
    expect(mean(draws)).toBeGreaterThan(0.9);
  });
  it('a fresh arm (1,1) is roughly uniform on average', () => {
    const rng = mulberry32(21);
    const draws = Array.from({ length: 2000 }, () => sampleBeta(1, 1, rng));
    expect(mean(draws)).toBeGreaterThan(0.45);
    expect(mean(draws)).toBeLessThan(0.55);
  });
});

describe('pickTopK', () => {
  it('returns k items, favoring higher-alpha arms over many trials', () => {
    const candidates = [
      { id: 'strong', arm: { alpha: 30, beta: 3 } },
      { id: 'weak', arm: { alpha: 3, beta: 30 } },
      { id: 'mid', arm: { alpha: 10, beta: 10 } },
    ];
    let strongPicked = 0;
    for (let s = 0; s < 200; s++) {
      const top = pickTopK(candidates, 1, mulberry32(s));
      expect(top).toHaveLength(1);
      if (top[0].id === 'strong') strongPicked++;
    }
    expect(strongPicked).toBeGreaterThan(150); // strong dominates but not always
  });
  it('never returns more than the candidate count', () => {
    expect(pickTopK([{ arm: { alpha: 1, beta: 1 } }], 3, mulberry32(1))).toHaveLength(1);
  });
});

describe('updateArm', () => {
  it('adds reward to alpha and (1-reward) to beta', () => {
    expect(updateArm({ alpha: 2, beta: 5 }, 1)).toEqual({ alpha: 3, beta: 5 });
    expect(updateArm({ alpha: 2, beta: 5 }, 0)).toEqual({ alpha: 2, beta: 6 });
  });
  it('supports fractional (half-weight) negative signals', () => {
    expect(updateArm({ alpha: 2, beta: 5 }, 0.5)).toEqual({ alpha: 2.5, beta: 5.5 });
  });
});

describe('priorAlpha', () => {
  it('maps percentile 0..1 to alpha 1..3, clamped', () => {
    expect(priorAlpha(0)).toBe(1);
    expect(priorAlpha(1)).toBe(3);
    expect(priorAlpha(0.5)).toBe(2);
    expect(priorAlpha(-1)).toBe(1);
    expect(priorAlpha(9)).toBe(3);
  });
});
