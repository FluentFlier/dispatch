/**
 * Phase: LinkedIn composer + preview
 *
 * Covers the pure preview/composer helpers (initials, URL normalization, and the
 * see-more threshold) that drive the live LinkedIn-style preview.
 */
import { describe, it, expect } from 'vitest';
import { getInitials, normalizeUrl, SEE_MORE_AT } from '@/lib/compose-preview';

describe('Phase: LinkedIn composer', () => {
  describe('getInitials', () => {
    it('takes up to two uppercase initials', () => {
      expect(getInitials('Rudheer Reddy Chintakuntla')).toBe('RR');
      expect(getInitials('ada')).toBe('A');
    });
    it('falls back to Y for empty/whitespace', () => {
      expect(getInitials('')).toBe('Y');
      expect(getInitials('   ')).toBe('Y');
    });
  });

  describe('normalizeUrl', () => {
    it('adds https when scheme is missing', () => {
      expect(normalizeUrl('example.com')).toBe('https://example.com');
    });
    it('keeps an existing scheme', () => {
      expect(normalizeUrl('http://x.com')).toBe('http://x.com');
      expect(normalizeUrl('https://x.com')).toBe('https://x.com');
    });
    it('returns empty for blank input', () => {
      expect(normalizeUrl('   ')).toBe('');
    });
  });

  it('exposes a sensible see-more threshold', () => {
    expect(SEE_MORE_AT).toBeGreaterThan(100);
    expect(SEE_MORE_AT).toBeLessThan(400);
  });
});
