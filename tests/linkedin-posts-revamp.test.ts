import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildPostIdCandidates } from '@/lib/engagement/unipile-reactions';

// chatCompletion / isLlmConfigured are mocked at the module boundary so the title
// helper can be tested without a live LLM.
vi.mock('@/lib/llm', () => ({
  describeImage: vi.fn(),
  isLlmConfigured: vi.fn(),
  chatCompletion: vi.fn(),
}));

import { generatePostTitle } from '@/lib/voice-lab/persist-imported-posts';
import { isLlmConfigured, chatCompletion } from '@/lib/llm';

describe('buildPostIdCandidates', () => {
  it('expands a pure-numeric LinkedIn activity id into every URN flavor', () => {
    expect(buildPostIdCandidates('12345')).toEqual([
      'urn:li:activity:12345',
      '12345',
      'urn:li:share:12345',
      'urn:li:ugcPost:12345',
    ]);
  });

  it('expands a URN-form id into its numeric core + sibling flavors (the comments-empty fix)', () => {
    const out = buildPostIdCandidates('urn:li:activity:7480006077112020993');
    // Verbatim id tried first, then the numeric core wrapped in other flavors.
    expect(out[0]).toBe('urn:li:activity:7480006077112020993');
    expect(out).toContain('urn:li:ugcPost:7480006077112020993');
    expect(out).toContain('urn:li:share:7480006077112020993');
    expect(out).toContain('7480006077112020993');
    // No duplicates.
    expect(new Set(out).size).toBe(out.length);
  });

  it('returns a non-numeric opaque id unchanged', () => {
    expect(buildPostIdCandidates('abc-def')).toEqual(['abc-def']);
  });
});

describe('generatePostTitle', () => {
  beforeEach(() => vi.clearAllMocks());

  it('falls back to the 80-char slice when the LLM is unconfigured', async () => {
    vi.mocked(isLlmConfigured).mockReturnValue(false);
    const body = 'x'.repeat(200);
    const title = await generatePostTitle(body);
    expect(title).toBe(body.slice(0, 80));
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it('uses the model output when configured, sanitizing quotes/newlines', async () => {
    vi.mocked(isLlmConfigured).mockReturnValue(true);
    vi.mocked(chatCompletion).mockResolvedValue('"My Great Post"\nignored second line');
    const title = await generatePostTitle('some long linkedin post body here');
    expect(title).toBe('My Great Post');
  });

  it('falls back when the model throws or returns junk', async () => {
    vi.mocked(isLlmConfigured).mockReturnValue(true);
    vi.mocked(chatCompletion).mockRejectedValue(new Error('over budget'));
    const body = 'real post body content';
    expect(await generatePostTitle(body)).toBe(body.slice(0, 80));
  });
});
