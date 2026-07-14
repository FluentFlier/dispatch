import { describe, it, expect } from 'vitest';
import { extractGroundedNames } from '@/lib/humanizer';

describe('extractGroundedNames (humanize name protection)', () => {
  it('captures multi-word names and CamelCase brands', () => {
    const names = extractGroundedNames(
      'At the summit I met Anirudh Manjesh and the founder of GreenLoop.',
    );
    expect(names).toContain('Anirudh Manjesh');
    expect(names).toContain('GreenLoop');
  });

  it('leaves ordinary single Capitalized words editable (no over-preserve)', () => {
    const names = extractGroundedNames('The event was in Phoenix on Monday.');
    expect(names).not.toContain('Phoenix');
    expect(names).not.toContain('Monday');
  });

  it('dedupes and caps the list', () => {
    const filler = Array.from({ length: 60 }, (_, i) => `Foo Bar${i}`).join(' ');
    const names = extractGroundedNames('Anirudh Manjesh ' + filler + ' Anirudh Manjesh');
    expect(names.length).toBeLessThanOrEqual(40);
    expect(names.filter((n) => n === 'Anirudh Manjesh').length).toBe(1);
  });
});
