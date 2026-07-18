/**
 * Pillar brief resolution: a custom pillar's stored template wins, built-in
 * slugs fall back to their bundled brief, and an unknown template-less pillar
 * has no bespoke steer (null) - so custom/emergent pillars can carry a real
 * brief like the built-ins do.
 */
import { describe, it, expect } from 'vitest';
import { resolvePillarBrief, isBuiltInPillar, BUILT_IN_PILLAR_BRIEFS } from '@/lib/pillars/briefs';

describe('resolvePillarBrief', () => {
  it('prefers a stored promptTemplate for any pillar', () => {
    expect(resolvePillarBrief('Marathon Training', 'Write about running.')).toBe('Write about running.');
    // Even for a built-in slug, an explicit template overrides the bundled one.
    expect(resolvePillarBrief('founder', 'Custom founder brief.')).toBe('Custom founder brief.');
  });

  it('falls back to the built-in brief for original slugs (any spelling)', () => {
    expect(resolvePillarBrief('hot-take')).toBe(BUILT_IN_PILLAR_BRIEFS['hot-take']);
    expect(resolvePillarBrief('Hot Take')).toBe(BUILT_IN_PILLAR_BRIEFS['hot-take']);
    expect(resolvePillarBrief('hot_take')).toBe(BUILT_IN_PILLAR_BRIEFS['hot-take']);
  });

  it('returns null for a custom pillar with no template (no bespoke steer yet)', () => {
    expect(resolvePillarBrief('Artificial Intelligence')).toBeNull();
    expect(resolvePillarBrief('Artificial Intelligence', '   ')).toBeNull();
  });

  it('isBuiltInPillar only matches the original slugs', () => {
    expect(isBuiltInPillar('research')).toBe(true);
    expect(isBuiltInPillar('Research')).toBe(true);
    expect(isBuiltInPillar('Marathon Training')).toBe(false);
  });
});
