import { describe, it, expect } from 'vitest';
import {
  extractTagMentions,
  mergeMentions,
  normalizeMentionHandle,
  parseMentionList,
  MAX_MENTIONS,
} from '@/lib/mentions';

describe('mentions helpers', () => {
  describe('normalizeMentionHandle', () => {
    it('strips leading @ and whitespace', () => {
      expect(normalizeMentionHandle('  @rudheer  ')).toBe('rudheer');
    });
  });

  describe('parseMentionList', () => {
    it('splits comma and space separated handles', () => {
      expect(parseMentionList('rudheer, jane_doe foo')).toEqual(['rudheer', 'jane_doe', 'foo']);
    });
  });

  describe('extractTagMentions', () => {
    it('finds tag@handle tokens in freeform text', () => {
      const text = 'Shout out tag@rudheer for the launch and tag@jane_doe too';
      expect(extractTagMentions(text)).toEqual(['rudheer', 'jane_doe']);
    });

    it('returns empty for plain @mentions without tag prefix', () => {
      expect(extractTagMentions('@rudheer helped with this')).toEqual([]);
    });
  });

  describe('mergeMentions', () => {
    it('dedupes case-insensitively and caps at MAX_MENTIONS', () => {
      const many = Array.from({ length: MAX_MENTIONS + 3 }, (_, i) => `user${i}`);
      const merged = mergeMentions(['Rudheer', 'rudheer', '@RUDHEER'], many);
      expect(merged[0]).toBe('Rudheer');
      expect(merged.filter((m) => m.toLowerCase() === 'rudheer')).toHaveLength(1);
      expect(merged.length).toBe(MAX_MENTIONS);
    });
  });
});
