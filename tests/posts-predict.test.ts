import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/insforge/server', () => ({
  getAuthenticatedUser: vi.fn(),
}));
vi.mock('@/lib/ai-guard', () => ({
  guardAiRequest: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock('@/lib/ai', () => ({
  generateContent: vi.fn(),
}));
vi.mock('@/lib/hooks-intelligence', () => ({
  getBestHooksForContext: vi.fn().mockReturnValue([
    { score: { total: 72 } },
    { score: { total: 68 } },
  ]),
}));

import { getAuthenticatedUser } from '@/lib/insforge/server';
import { generateContent } from '@/lib/ai';
import { NextRequest } from 'next/server';

const mockAIResponse = JSON.stringify({
  hook: 8,
  depth: 7,
  platform_fit: 9,
  resonance: 7,
  signals: ['Strong opening with a number', 'Good platform length', 'Personal angle present'],
  suggestion: 'Add a question at the end to drive comments.',
});

const strongPost = `5 things I learned after 2 years of building in public.

Everyone told me to wait until the product was perfect. I did the opposite.

Here is what happened:
1. Early users gave me better feedback than any advisor.
2. Public accountability kept me shipping weekly.
3. Followers became beta testers before I asked.

The awkward early posts still bring me new users today.

What is stopping you from sharing your work now?`;

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/posts/predict', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/posts/predict', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getAuthenticatedUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'user_123' });
    (generateContent as ReturnType<typeof vi.fn>).mockResolvedValue(mockAIResponse);
  });

  it('returns 401 when not authenticated', async () => {
    (getAuthenticatedUser as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const { POST } = await import('@/app/api/posts/predict/route');
    const res = await POST(makeRequest({ text: strongPost, platform: 'linkedin' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 for text under 10 chars', async () => {
    const { POST } = await import('@/app/api/posts/predict/route');
    const res = await POST(makeRequest({ text: 'hi', platform: 'linkedin' }));
    expect(res.status).toBe(400);
  });

  it('returns tier, score, signals, suggestion, and breakdown', async () => {
    const { POST } = await import('@/app/api/posts/predict/route');
    const res = await POST(makeRequest({ text: strongPost, platform: 'linkedin', voice_match_score: 85, ai_score: 15 }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tier).toMatch(/^(strong|average|weak)$/);
    expect(typeof body.score).toBe('number');
    expect(body.score).toBeGreaterThanOrEqual(0);
    expect(body.score).toBeLessThanOrEqual(100);
    expect(Array.isArray(body.signals)).toBe(true);
    expect(typeof body.suggestion).toBe('string');
    expect(body.breakdown).toHaveProperty('deterministic');
    expect(body.breakdown).toHaveProperty('ai');
  });

  it('scores post with numbered hook as strong', async () => {
    const { POST } = await import('@/app/api/posts/predict/route');
    const res = await POST(makeRequest({ text: strongPost, platform: 'linkedin', voice_match_score: 88 }));
    const body = await res.json();
    expect(body.hook_score).toBeGreaterThanOrEqual(7);
    expect(body.tier).toBe('strong');
  });

  it('degrades gracefully when AI pass fails', async () => {
    (generateContent as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('AI timeout'));
    const { POST } = await import('@/app/api/posts/predict/route');
    const res = await POST(makeRequest({ text: strongPost, platform: 'linkedin' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.breakdown.deterministic).toBe(body.breakdown.ai);
  });

  it('flags over-limit twitter post in signals', async () => {
    const longTweet = 'word '.repeat(70).trim(); // ~350 chars
    const { POST } = await import('@/app/api/posts/predict/route');
    const res = await POST(makeRequest({ text: longTweet, platform: 'twitter' }));
    const body = await res.json();
    expect(body.signals.some((s: string) => s.includes('limit'))).toBe(true);
  });
});
