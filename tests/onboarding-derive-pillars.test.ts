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

  it('skips rows where name is an object instead of a string', () => {
    const out = parseDerivedPillars('[{"name":{"nested":"x"},"description":"x"},{"name":"GTM","description":"y"}]');
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('GTM');
  });

  it('skips rows where name is an array instead of a string', () => {
    const out = parseDerivedPillars('[{"name":["a","b"],"description":"x"},{"name":"GTM","description":"y"}]');
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('GTM');
  });

  it('does not end in a lone surrogate when truncating an emoji-heavy name', () => {
    // 25 emoji truncated to 24 codepoints. Each emoji is 2 UTF-16 units, so result is 48 units.
    // The risk with naive .slice() is cutting between the high and low surrogates.
    // Array.from() handles this correctly by working with codepoints.
    const emoji = '😀'.repeat(25);
    const out = parseDerivedPillars(`[{"name":"${emoji}","description":"x"}]`);
    const name = out[0].name;
    // Should be 24 complete emoji = 48 UTF-16 units
    expect(name.length).toBe(48);
    // Verify it's valid by checking it doesn't have a lone high surrogate at the end
    expect(/[\uD800-\uDBFF]$/.test(name)).toBe(false);
  });

  it('does not end in whitespace when a space falls at the truncation boundary', () => {
    // 24 A's followed by a space, which will be at position 24
    // After truncating to 24 codepoints, we'll have 24 A's + space
    // The second trim() should remove that trailing space
    const name = 'A'.repeat(24) + ' ';
    const out = parseDerivedPillars(`[{"name":"${name}","description":"x"}]`);
    expect(out[0].name).toBe('A'.repeat(24));
    expect(!/\s$/.test(out[0].name)).toBe(true);
  });
});
