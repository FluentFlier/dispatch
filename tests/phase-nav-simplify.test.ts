import { describe, it, expect } from 'vitest';
import { moreNav, navItems, primaryNav } from '@/lib/nav-config';

describe('Phase: Nav simplify', () => {
  it('orders primary nav by creator daily loop', () => {
    expect(primaryNav.map((i) => i.href)).toEqual([
      '/dashboard',
      '/generate',
      '/library',
      '/calendar',
      '/inbox',
      '/leads',
    ]);
  });

  it('labels inbox as Inbox not Comments', () => {
    const inbox = primaryNav.find((i) => i.href === '/inbox');
    expect(inbox?.name).toBe('Inbox');
  });

  it('promotes Leads to primary nav', () => {
    expect(primaryNav.some((i) => i.href === '/leads')).toBe(true);
    expect(moreNav.some((i) => i.href === '/leads')).toBe(false);
  });

  it('hides video studio from visible nav', () => {
    const video = navItems.find((i) => i.href === '/video-studio');
    expect(video?.hidden).toBe(true);
    expect(moreNav.some((i) => i.href === '/video-studio')).toBe(false);
    expect(primaryNav.some((i) => i.href === '/video-studio')).toBe(false);
  });
});
