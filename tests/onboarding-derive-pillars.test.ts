import { describe, it, expect } from 'vitest';
import { parseDerivedPillars, DEFAULT_PILLARS } from '@/lib/onboarding/derive-pillars';

describe('parseDerivedPillars', () => {
  it('falls back to the default pillar on empty input', () => {
    expect(parseDerivedPillars('')).toEqual(DEFAULT_PILLARS);
  });

  it('falls back to the default pillar on unparseable output', () => {
    expect(parseDerivedPillars('I think maybe fintech?')).toEqual(DEFAULT_PILLARS);
  });

  it('falls back when the model returns valid JSON of the wrong shape', () => {
    expect(parseDerivedPillars('{"nope":true}')).toEqual(DEFAULT_PILLARS);
    expect(parseDerivedPillars('[]')).toEqual(DEFAULT_PILLARS);
  });

  it('maps a valid array and assigns distinct colors', () => {
    const out = parseDerivedPillars('[{"name":"GTM","description":"Founder-led sales"},{"name":"Fintech","description":"Treasury"}]');
    expect(out).toHaveLength(2);
    expect(out[0].name).toBe('GTM');
    expect(out[0].description).toBe('Founder-led sales');
    expect(out[1].name).toBe('Fintech');
    expect(out[0].color).not.toBe(out[1].color);
  });

  it('reads a fenced JSON block', () => {
    const out = parseDerivedPillars('```json\n[{"name":"Hiring","description":"Team building"}]\n```');
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('Hiring');
  });

  it('caps at three pillars', () => {
    const raw = JSON.stringify(
      ['A', 'B', 'C', 'D', 'E'].map((n) => ({ name: n, description: 'x' })),
    );
    expect(parseDerivedPillars(raw)).toHaveLength(3);
  });

  it('drops entries with an unusable name and keeps the rest', () => {
    const out = parseDerivedPillars('[{"name":"","description":"x"},{"name":"GTM","description":"y"}]');
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('GTM');
  });

  it('truncates an overlong name rather than dropping it', () => {
    const long = 'A'.repeat(60);
    const out = parseDerivedPillars(`[{"name":"${long}","description":"x"}]`);
    expect(out[0].name).toHaveLength(24);
  });

  it('never throws on hostile input', () => {
    for (const raw of ['null', 'undefined', '[[[', '{"name":', '0']) {
      expect(() => parseDerivedPillars(raw)).not.toThrow();
    }
  });
});
