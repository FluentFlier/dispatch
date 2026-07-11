/**
 * Beta-Bernoulli Thompson sampling for per-(niche, hook) selection.
 * Beta(alpha, beta) is drawn as G(alpha)/(G(alpha)+G(beta)) with G a Gamma(shape,1)
 * via Marsaglia-Tsang. No npm dep exists worth pulling for this (~40 lines).
 * Every function takes an injectable rng so tests are deterministic (Global
 * Constraints: seeded RNG).
 */

export type RNG = () => number;
export interface Arm { alpha: number; beta: number }

/** Standard normal via Box-Muller, using the injected uniform rng. */
function gaussian(rng: RNG): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Gamma(shape, scale=1) via Marsaglia-Tsang. Handles shape < 1 by boosting. */
function sampleGamma(shape: number, rng: RNG): number {
  if (shape < 1) {
    // Boost: Gamma(shape) = Gamma(shape+1) * U^(1/shape).
    return sampleGamma(shape + 1, rng) * Math.pow(rng() || Number.EPSILON, 1 / shape);
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = gaussian(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Draws one sample from Beta(alpha, beta). */
export function sampleBeta(alpha: number, beta: number, rng: RNG = Math.random): number {
  const x = sampleGamma(Math.max(alpha, 1e-6), rng);
  const y = sampleGamma(Math.max(beta, 1e-6), rng);
  const sum = x + y;
  return sum > 0 ? x / sum : 0.5;
}

/** Samples the success-probability estimate theta for one arm. */
export function sampleTheta(arm: Arm, rng: RNG = Math.random): number {
  return sampleBeta(arm.alpha, arm.beta, rng);
}

/** Samples every candidate once and returns the k highest draws. */
export function pickTopK<T extends { arm: Arm }>(candidates: T[], k: number, rng: RNG = Math.random): T[] {
  return candidates
    .map((c) => ({ c, theta: sampleTheta(c.arm, rng) }))
    .sort((a, b) => b.theta - a.theta)
    .slice(0, k)
    .map((x) => x.c);
}

/** Bayesian update: reward in [0,1] adds to alpha, its complement to beta. */
export function updateArm(arm: Arm, reward: number): Arm {
  return { alpha: arm.alpha + reward, beta: arm.beta + (1 - reward) };
}

/** Informative prior alpha = 1 + 2 * percentile, clamped so alpha in [1,3] (spec 2.3.7). */
export function priorAlpha(percentile: number): number {
  return 1 + 2 * Math.min(1, Math.max(0, percentile));
}
