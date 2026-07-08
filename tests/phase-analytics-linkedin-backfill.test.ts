import { describe, it, expect } from 'vitest';
import {
  indexLinkedInListMetrics,
  lookupMetricsPatch,
  providerPostIdAliases,
  providerPostIdsMatch,
} from '@/lib/analytics/linkedin-metrics-sync';

describe('linkedin metrics sync helpers', () => {
  describe('providerPostIdAliases', () => {
    it('includes urn and numeric variants for LinkedIn activity ids', () => {
      const aliases = providerPostIdAliases('urn:li:activity:12345');
      expect(aliases).toContain('urn:li:activity:12345');
      expect(aliases).toContain('12345');
    });
  });

  describe('providerPostIdsMatch', () => {
    it('matches list id to stored publish_job provider_post_id', () => {
      expect(providerPostIdsMatch('urn:li:activity:999', '999')).toBe(true);
      expect(providerPostIdsMatch('urn:li:activity:999', 'urn:li:share:888')).toBe(false);
    });
  });

  describe('indexLinkedInListMetrics', () => {
    it('indexes metrics under every alias for a list item id', () => {
      const index = indexLinkedInListMetrics([
        {
          id: 'urn:li:activity:42',
          analytics: { impressions: 500, reactions: 12, comments: 3 },
        },
      ]);

      expect(lookupMetricsPatch(index, '42')).toEqual({
        views: 500,
        likes: 12,
        comments: 3,
      });
      expect(lookupMetricsPatch(index, 'urn:li:activity:42')).toEqual({
        views: 500,
        likes: 12,
        comments: 3,
      });
    });
  });
});
