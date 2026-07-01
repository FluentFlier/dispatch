/**
 * Phase: Unify Generate + Optimize
 *
 * The platform-optimization prompt is now shared between the main generate
 * (integrated human-polish pass) and the repurpose panel. These lock the
 * platform rules and the "exclude the source platform" repurpose logic.
 */
import { describe, it, expect } from 'vitest';
import {
  buildPlatformOptimizationPrompt,
  PLATFORM_LIMITS,
  type OptimizePlatform,
} from '@/lib/platform-optimize';

/** Mirror of the panel's target selection: repurpose never targets the source. */
function repurposeTargets(source: OptimizePlatform, connected: OptimizePlatform[]): OptimizePlatform[] {
  const ALL: OptimizePlatform[] = ['twitter', 'linkedin', 'instagram', 'threads'];
  const other = connected.filter((p) => p !== source);
  return other.length > 0 ? other : ALL.filter((p) => p !== source);
}

describe('Phase: Unify Generate + Optimize', () => {
  describe('buildPlatformOptimizationPrompt', () => {
    it('applies LinkedIn rules (human tone, 3000 chars, hook + CTA)', () => {
      const p = buildPlatformOptimizationPrompt('linkedin', 'my draft', 'full');
      expect(p).toContain('LinkedIn');
      expect(p).toContain('Professional but human tone');
      expect(p).toContain('3000');
      expect(p).toContain('my draft');
    });

    it('applies Twitter thread rules with the 280 limit', () => {
      const p = buildPlatformOptimizationPrompt('twitter', 'x', 'full');
      expect(p).toContain('280');
      expect(p).toContain('---TWEET---');
    });

    it('light level preserves structure, full rewrites', () => {
      expect(buildPlatformOptimizationPrompt('linkedin', 'x', 'light')).toContain('Make minimal changes');
      expect(buildPlatformOptimizationPrompt('linkedin', 'x', 'full')).toContain('Fully rewrite');
    });

    it('exposes correct platform character limits', () => {
      expect(PLATFORM_LIMITS).toEqual({ twitter: 280, linkedin: 3000, instagram: 2200, threads: 500 });
    });
  });

  describe('repurpose target selection (source excluded)', () => {
    it('excludes the source platform from connected targets', () => {
      expect(repurposeTargets('linkedin', ['linkedin', 'twitter', 'instagram']))
        .toEqual(['twitter', 'instagram']);
    });

    it('falls back to all other platforms when none connected', () => {
      expect(repurposeTargets('linkedin', [])).toEqual(['twitter', 'instagram', 'threads']);
    });

    it('never returns the source platform', () => {
      for (const src of ['twitter', 'linkedin', 'instagram', 'threads'] as OptimizePlatform[]) {
        expect(repurposeTargets(src, [])).not.toContain(src);
      }
    });
  });
});
