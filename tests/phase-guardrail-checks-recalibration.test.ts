/**
 * Phase: Guardrail Consolidation - Task 1 regression net.
 * Locks in the three Phase 1 -> Phase 3 handoff fixes: bait_hook broetry
 * recalibration, fabricated_specifics sentence-start fix, and
 * styleRulesFromChecks being genuinely registry-derived.
 */
import { describe, it, expect } from 'vitest';
import { runChecks, styleRulesFromChecks, CHECKS, type CheckContext } from '@/lib/content-pipeline/checks';

const ctx = (over: Partial<CheckContext> = {}): CheckContext => ({
  contentType: 'post', platform: 'linkedin', userPrompt: 'x', ...over,
});

describe('Phase: Guardrail Consolidation - checks recalibration', () => {
  it('bait_hook no longer false-positives on a 4-line numbered listicle', () => {
    const text = '1. Ship fast\n2. Talk to users\n3. Charge money\n4. Repeat forever\n\n' +
      'Nothing fancy about it. Just discipline, repeated weekly, for eighteen months straight.';
    const r = runChecks(text, ctx()).find((x) => x.id === 'bait_hook')!;
    expect(r.pass).toBe(true);
  });

  it('fabricated_specifics catches a fabricated name at the very start of a sentence', () => {
    const text = 'We shipped the launch on a Tuesday morning without telling anyone in advance.\n\n' +
      'Sundar Pichai even called to congratulate the team on it.';
    const r = runChecks(text, ctx({ userPrompt: 'write about our launch' })).find((x) => x.id === 'fabricated_specifics')!;
    expect(r.pass).toBe(false);
  });

  it('still catches a fabricated org name behind a whitelisted starter word ("The ...")', () => {
    // Fix round 1: whitelisting words[0] must not discard the WHOLE run.
    // "The National Business Research Institute" is the flagship D.1 prod
    // fabrication; strip the starter word and re-check the remainder.
    const text = 'We looked hard at our own hiring data this quarter.\n\n' +
      'The National Business Research Institute found hiring slowed.';
    const r = runChecks(text, ctx({ userPrompt: 'write about hiring trends' })).find((x) => x.id === 'fabricated_specifics')!;
    expect(r.pass).toBe(false);
    expect(r.evidence).toContain('National Business Research Institute');
  });

  it('still catches a fabricated name mid-sentence behind "The"', () => {
    const text = 'We looked hard at our own hiring data this quarter.\n\n' +
      'A recent report from The McKinsey Institute said so.';
    const r = runChecks(text, ctx({ userPrompt: 'write about hiring trends' })).find((x) => x.id === 'fabricated_specifics')!;
    expect(r.pass).toBe(false);
  });

  it('passes a whitelisted starter followed by a single whitelisted word ("Last Tuesday")', () => {
    const text = 'We looked hard at our own hiring data this quarter.\n\n' +
      'Last Tuesday we shipped.';
    const r = runChecks(text, ctx({ userPrompt: 'write about hiring trends' })).find((x) => x.id === 'fabricated_specifics')!;
    expect(r.pass).toBe(true);
  });

  it('passes "The <org>" when the org name is present in sourceContext', () => {
    const text = 'We looked hard at our own hiring data this quarter.\n\n' +
      'The National Business Research Institute found hiring slowed.';
    const c = ctx({
      userPrompt: 'write about hiring trends',
      sourceContext: 'Study by the National Business Research Institute: hiring slowed this year.',
    });
    const r = runChecks(text, c).find((x) => x.id === 'fabricated_specifics')!;
    expect(r.pass).toBe(true);
  });

  it('every hard check that gates generation has a ruleText (no silent registry/prompt gap)', () => {
    const gatingHardIds = ['em_dash', 'markdown', 'fabricated_specifics', 'paragraph_shape', 'slop_phrases', 'bait_hook'];
    for (const id of gatingHardIds) {
      const check = CHECKS.find((c) => c.id === id)!;
      expect(check.ruleText, `${id} has no ruleText`).toBeDefined();
    }
  });

  it('styleRulesFromChecks output changes when a check applies differently per ctx (proves derivation, not a static blob)', () => {
    const post = styleRulesFromChecks(ctx({ contentType: 'post' }));
    const reply = styleRulesFromChecks(ctx({ contentType: 'reply' }));
    expect(post).not.toEqual(reply);
  });
});
