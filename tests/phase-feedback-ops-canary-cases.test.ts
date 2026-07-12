/**
 * Phase: Feedback Ops - canary case set invariants (spec 4.3).
 * Fixed 50-case subset: deterministic, adversarial-heavy, NEVER touches
 * holdout (Goodhart guard), fixtures inlined so the serverless cron needs
 * no filesystem access.
 */
import { describe, it, expect } from 'vitest';
import { CANARY_CASES } from '@/lib/eval-canary/cases';

describe('canary case set', () => {
  it('has exactly 50 cases with unique ids', () => {
    expect(CANARY_CASES).toHaveLength(50);
    expect(new Set(CANARY_CASES.map((c) => c.id)).size).toBe(50);
  });
  it('never includes holdout cases', () => {
    for (const c of CANARY_CASES) {
      expect(c.description.toLowerCase()).not.toContain('holdout');
    }
  });
  it('every case has a non-empty userPrompt', () => {
    for (const c of CANARY_CASES) {
      expect((c.vars.userPrompt ?? '').length).toBeGreaterThan(5);
    }
  });
  it('includes adversarial coverage (provider drift shows there first)', () => {
    expect(CANARY_CASES.filter((c) => c.description.startsWith('adversarial')).length).toBeGreaterThanOrEqual(5);
  });
  it('cases referencing a profile fixture carry it inline (no fs in serverless)', () => {
    for (const c of CANARY_CASES) {
      if (c.vars.profileFixture) {
        expect(c.vars.inlineFixture).toBeDefined();
        expect(c.vars.inlineFixture!.profile).toBeDefined();
      }
    }
  });
});
