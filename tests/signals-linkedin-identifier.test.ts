import { describe, expect, it } from 'vitest';
import { linkedInIdentifierFromSignal } from '@/lib/signals/linkedin-identifier';

describe('linkedInIdentifierFromSignal', () => {
  it('builds profile URL from handle', () => {
    expect(
      linkedInIdentifierFromSignal({ authorHandle: '@jane-founder' }),
    ).toBe('https://linkedin.com/in/jane-founder');
  });

  it('passes through full linkedin URLs', () => {
    expect(
      linkedInIdentifierFromSignal({
        authorHandle: 'https://linkedin.com/in/jane',
      }),
    ).toBe('https://linkedin.com/in/jane');
  });

  it('falls back to person name slug', () => {
    expect(linkedInIdentifierFromSignal({ personName: 'Jane Doe' })).toBe(
      'https://linkedin.com/in/jane-doe',
    );
  });

  it('returns empty when no hints', () => {
    expect(linkedInIdentifierFromSignal({})).toBe('');
  });
});
