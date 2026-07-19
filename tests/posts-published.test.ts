/**
 * The "published" predicate that every latest-post / analytics surface routes
 * through. Guards the regression where a draft carrying status='posted' but no
 * posted_date was ranked as the creator's latest post.
 */
import { describe, it, expect } from 'vitest';
import {
  isPublished,
  publishedAt,
  pickLatestPublished,
  onlyPublished,
} from '../src/lib/posts/published';

describe('isPublished', () => {
  it('requires both a posted status and a posted_date', () => {
    expect(isPublished({ status: 'posted', posted_date: '2026-07-14' })).toBe(true);
    expect(isPublished({ status: 'posted', posted_date: null })).toBe(false);
    expect(isPublished({ status: 'posted' })).toBe(false);
    expect(isPublished({ status: 'edited', posted_date: '2026-07-14' })).toBe(false);
    expect(isPublished({ status: 'idea', posted_date: null })).toBe(false);
  });
});

describe('publishedAt', () => {
  it('never falls back to a row-touched timestamp', () => {
    expect(publishedAt({ status: 'posted', posted_date: '2026-07-14' })).toBe('2026-07-14');
    expect(publishedAt({ status: 'posted', posted_date: null })).toBeNull();
    expect(publishedAt({ status: 'edited', posted_date: '2026-07-14' })).toBeNull();
  });
});

describe('pickLatestPublished', () => {
  it('ignores an undated draft even when it is the most recently touched row', () => {
    const draft = { id: 'draft', status: 'posted', posted_date: null };
    const real = { id: 'real', status: 'posted', posted_date: '2026-07-14' };
    expect(pickLatestPublished([draft, real])?.id).toBe('real');
  });

  it('returns the newest genuinely-published post', () => {
    const older = { id: 'older', status: 'posted', posted_date: '2026-07-01' };
    const newer = { id: 'newer', status: 'posted', posted_date: '2026-07-14' };
    expect(pickLatestPublished([older, newer])?.id).toBe('newer');
    expect(pickLatestPublished([newer, older])?.id).toBe('newer');
  });

  it('returns null when nothing has actually been published', () => {
    expect(pickLatestPublished([{ status: 'posted', posted_date: null }])).toBeNull();
    expect(pickLatestPublished([])).toBeNull();
  });
});

describe('onlyPublished', () => {
  it('adds both the status filter and the posted_date NOT NULL guard', () => {
    const calls: string[] = [];
    const builder = {
      eq(col: string, val: string) {
        calls.push(`eq:${col}=${val}`);
        return this;
      },
      not(col: string, op: string, val: null) {
        calls.push(`not:${col} ${op} ${String(val)}`);
        return this;
      },
    };
    onlyPublished(builder);
    expect(calls).toEqual(['eq:status=posted', 'not:posted_date is null']);
  });
});
