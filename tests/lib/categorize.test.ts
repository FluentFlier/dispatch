import { describe, it, expect } from 'vitest';
import { categorizeEngager, bucketEngagers } from '@/lib/hooks-intelligence/categorize';

describe('categorizeEngager', () => {
  it('classifies founders/CEOs/builders as ICP', () => {
    expect(categorizeEngager({ bio: 'Founder at Acme', engagementType: 'like' })).toBe('ICP');
    expect(categorizeEngager({ bio: 'CEO of things', engagementType: 'follow' })).toBe('ICP');
    expect(categorizeEngager({ bio: 'builder of products', engagementType: 'like' })).toBe('ICP');
  });

  it('treats custom target keywords as ICP signals', () => {
    expect(
      categorizeEngager({ bio: 'Head of Growth', engagementType: 'like' }, ['head of growth']),
    ).toBe('ICP');
  });

  it('classifies makers/creators/designers as Community', () => {
    expect(categorizeEngager({ bio: 'indie maker and designer', engagementType: 'like' })).toBe('Community');
    expect(categorizeEngager({ bio: 'writer + creator', engagementType: 'follow' })).toBe('Community');
  });

  it('flags inquisitive commenters as Potential Lead', () => {
    expect(categorizeEngager({ bio: 'how do i do this?', engagementType: 'comment' })).toBe('Potential Lead');
  });

  it('falls back to Other', () => {
    expect(categorizeEngager({ bio: 'just a person', engagementType: 'like' })).toBe('Other');
  });

  it('buckets a mixed list correctly', () => {
    const buckets = bucketEngagers([
      { bio: 'founder', engagementType: 'like' },
      { bio: 'designer', engagementType: 'like' },
      { bio: 'random person', engagementType: 'like' },
    ]);
    expect(buckets.ICP).toHaveLength(1);
    expect(buckets.Community).toHaveLength(1);
    expect(buckets.Other).toHaveLength(1);
    expect(buckets['Potential Lead']).toHaveLength(0);
  });
});
