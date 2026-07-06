import { describe, expect, it } from 'vitest';
import { icpToSearchQuery } from '@/lib/signals/icp/parse-description';

describe('ICP parse helpers', () => {
  it('icpToSearchQuery joins verticals and keywords', () => {
    expect(icpToSearchQuery(['Fintech', 'SaaS'], ['treasury', 'YC'])).toBe('Fintech SaaS treasury YC');
  });

  it('icpToSearchQuery falls back to description', () => {
    expect(icpToSearchQuery([], [], 'seed fintech startups')).toBe('seed fintech startups');
  });

  it('icpToSearchQuery returns empty when nothing configured', () => {
    expect(icpToSearchQuery([], [], null)).toBe('');
  });
});
