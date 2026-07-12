import { describe, it, expect } from 'vitest';
import { classifyUrl } from '@/lib/voice-lab/scrape-url';

describe('classifyUrl', () => {
  it('routes LinkedIn profiles to the Apify path', () => {
    expect(classifyUrl('https://www.linkedin.com/in/amanjesh/')).toBe('linkedin-profile');
    expect(classifyUrl('https://linkedin.com/company/openai')).toBe('linkedin-profile');
    expect(classifyUrl('https://www.linkedin.com/school/mit/')).toBe('linkedin-profile');
  });

  it('routes other LinkedIn urls (post permalinks) to the TinyFish-only path', () => {
    expect(classifyUrl('https://www.linkedin.com/feed/update/urn:li:activity:123/')).toBe('linkedin-other');
    expect(classifyUrl('https://www.linkedin.com/posts/amanjesh_hello-activity-123')).toBe('linkedin-other');
  });

  it('treats non-LinkedIn urls as generic web (reader path)', () => {
    expect(classifyUrl('https://example.com/blog/post')).toBe('web');
    expect(classifyUrl('https://amanjesh.substack.com/p/thing')).toBe('web');
    // not-a-linkedin lookalike host must not be misrouted
    expect(classifyUrl('https://linkedin.com.evil.example/in/x')).toBe('web');
    expect(classifyUrl('not a url')).toBe('web');
  });
});
