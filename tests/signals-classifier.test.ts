import { describe, expect, it } from 'vitest';
import { classifyPost } from '@/lib/signals/classifier';
import type { IngestedPost } from '@/lib/signals/types';

function post(content: string, overrides: Partial<IngestedPost> = {}): IngestedPost {
  return {
    platform: 'x',
    externalPostId: 'test-1',
    authorHandle: 'founder',
    authorName: 'Jane Founder',
    content,
    ...overrides,
  };
}

describe('classifyPost', () => {
  it('detects YC accelerator signal', () => {
    const result = classifyPost(
      post('Excited to announce we got into YC W25! Building payments infra for startups.'),
    );
    expect(result).not.toBeNull();
    expect(result!.signalType).toBe('accelerator_join');
    expect(result!.acceleratorName).toBe('Y Combinator');
    expect(result!.batch).toBe('W25');
    expect(result!.confidence).toBeGreaterThanOrEqual(0.55);
  });

  it('detects funding signal', () => {
    const result = classifyPost(
      post('We just raised a $4M seed round backed by great partners. Thank you to everyone who believed in us.'),
    );
    expect(result).not.toBeNull();
    expect(result!.signalType).toBe('funding_round');
  });

  it('returns null for irrelevant posts', () => {
    const result = classifyPost(post('Beautiful sunset today. Grateful for the little things.'));
    expect(result).toBeNull();
  });

  it('dedupes same company/batch across posts', () => {
    const a = classifyPost(post('Joining YC S24 batch to build fintech APIs', { authorHandle: 'acme' }));
    const b = classifyPost(post('Joining YC S24 batch to build fintech APIs', { authorHandle: 'acme', externalPostId: 'other' }));
    expect(a!.dedupeKey).toBe(b!.dedupeKey);
  });

  // F7: "Building the future..." must NOT yield the article "the" as a company name.
  it('does not extract a stopword as the company name', () => {
    const result = classifyPost(
      post('Excited to announce we joined Y Combinator W26! Building the future of fintech for startups.', {
        authorName: 'Jordan Kim',
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.companyName).toBeUndefined();
    expect(result!.personName).toBe('Jordan Kim');
  });

  it('extracts a proper-noun company name', () => {
    const result = classifyPost(
      post('We just raised a $5M seed round. I am building Acme to fix payments for startups.', {
        authorName: 'Jane',
      }),
    );
    expect(result).not.toBeNull();
    expect(result!.companyName).toBe('Acme');
  });
});
