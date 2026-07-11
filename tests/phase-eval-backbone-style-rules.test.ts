/**
 * Phase: Eval Backbone - styleRulesFromChecks.
 * The prompt rule block is GENERATED from the registry so prompt and guard
 * can never diverge (divergence caused the f3b5a5c revise-loop oscillation).
 * Parity test: every semantic rule in compact.ts HARD_RULES must be covered.
 */
import { describe, it, expect } from 'vitest';
import { styleRulesFromChecks, type CheckContext } from '@/lib/content-pipeline/checks';

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
    expect(rules).not.toMatch(/[—–]/);
  });
});
