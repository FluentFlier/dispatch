import { describe, expect, it } from 'vitest';
import { normalizeUnipileDsn } from '@/lib/unipile/config';

describe('normalizeUnipileDsn', () => {
  it('strips https scheme and trailing slash', () => {
    expect(normalizeUnipileDsn('https://api8.unipile.com:13879/')).toBe('api8.unipile.com:13879');
    expect(normalizeUnipileDsn('api8.unipile.com:13879')).toBe('api8.unipile.com:13879');
  });
});
