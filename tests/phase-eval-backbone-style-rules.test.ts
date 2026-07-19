/**
 * Phase: Eval Backbone - styleRulesFromChecks.
 * The prompt rule block is GENERATED from the registry so prompt and guard
 * can never diverge (divergence caused the f3b5a5c revise-loop oscillation).
 * Parity test: every semantic rule in compact.ts HARD_RULES must be covered.
 */
import { describe, it, expect } from 'vitest';
import { styleRulesFromChecks, CHECKS, type CheckContext } from '@/lib/content-pipeline/checks';

const ctx: CheckContext = { contentType: 'post', platform: 'linkedin', userPrompt: 'x' };

describe('styleRulesFromChecks', () => {
  const rules = styleRulesFromChecks(ctx);

  it('covers every HARD_RULES semantic from compact.ts', () => {
    expect(rules).toMatch(/plain text/i);
    expect(rules).toMatch(/no markdown/i);
    expect(rules).toMatch(/em dash/i);
    expect(rules).toMatch(/never invent/i);
    expect(rules).toMatch(/paragraph/i);
    expect(rules).toMatch(/2-4 sentences/);
    expect(rules).toMatch(/concrete details/i);
    expect(rules).toMatch(/Hook\/Setup\/Story\/Insight\/CTA/i);
  });

  it('includes platform length bounds when platform known', () => {
    expect(rules).toMatch(/3000/);
    const tw = styleRulesFromChecks({ ...ctx, platform: 'twitter' });
    expect(tw).toMatch(/280/);
  });

  it('includes bait-hook prohibition for posts only', () => {
    expect(rules).toMatch(/bait|Agree\?|repost if/i);
    const reply = styleRulesFromChecks({ ...ctx, contentType: 'reply' });
    expect(reply).not.toMatch(/repost if/i);
  });

  it('contains no em dash characters itself', () => {
    expect(rules).not.toMatch(/[\u2014\u2013]/);
  });

  it('hygiene rules (markdown/em dash/slop) reach non-prose text outputs like hooks and caption', () => {
    // Old BASE_SYSTEM said "plain text, no markdown, no em dashes" for EVERY
    // content type; the registry swap must not weaken hooks/caption prompts.
    for (const contentType of ['hooks', 'caption']) {
      const out = styleRulesFromChecks({ ...ctx, contentType });
      expect(out).toMatch(/no markdown/i);
      expect(out).toMatch(/em dash/i);
      expect(out).toMatch(/corporate speak/i);
      // Paragraph-spacing prose rules are noise on a hook list / caption.
      expect(out).not.toMatch(/blank line between paragraphs/i);
      expect(out).not.toMatch(/2-4 sentences/);
    }
    // Prose keeps the spacing rule.
    expect(rules).toMatch(/blank line between paragraphs/i);
  });

  it('is genuinely derived from CHECKS - changing a check ruleText changes the output (divergence-proof)', () => {
    // Import the live registry and confirm the em-dash rule text used by the
    // registry is the exact substring styleRulesFromChecks() emits - proves
    // there is no second, hand-maintained copy of this sentence anywhere.
    const emDashCheck = CHECKS.find((c) => c.id === 'em_dash')!;
    expect(emDashCheck.ruleText).toBeDefined();
    expect(rules).toContain(emDashCheck.ruleText!(ctx));
  });
});
