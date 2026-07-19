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
    // 23 single-byte A's (23 UTF-16 units) + 5 emoji (10 UTF-16 units = 33 total).
    // Naive .slice(0, 24) cuts the first emoji in half, leaving a lone high surrogate.
    // Correct codepoint-based truncation keeps 23 A + 1 complete emoji.
    const input = 'A'.repeat(23) + '\u{1F600}'.repeat(5);
    const out = parseDerivedPillars(`[{"name":"${input}","description":"x"}]`);
    const name = out[0].name;
    // Must not end in a lone high surrogate (surrogate range U+D800 to U+DBFF)
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

  it('preserves real content when leading whitespace would consume budget', () => {
    // 24 spaces followed by "GTM". Without trimming before truncation, these spaces
    // consume the entire 24-codepoint budget and the row is dropped.
    // Trimming first ensures leading whitespace doesn't waste budget.
    const name = ' '.repeat(24) + 'GTM';
    const out = parseDerivedPillars(`[{"name":"${name}","description":"x"}]`);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('GTM');
  });
});
