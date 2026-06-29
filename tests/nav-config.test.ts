import { describe, expect, it } from 'vitest';
import { bottomBarNav, moreNav, primaryNav } from '@/lib/nav-config';

describe('nav-config', () => {
  it('includes Signals in primary and mobile nav', () => {
    expect(primaryNav.some((item) => item.href === '/signals' && item.name === 'Signals')).toBe(true);
    expect(bottomBarNav.some((item) => item.href === '/signals')).toBe(true);
    expect(moreNav.some((item) => item.href === '/signals')).toBe(false);
  });
});
