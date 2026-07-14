/**
 * Regression tests for the Voice Lab import flow.
 *
 * Two independent bugs surfaced during a LinkedIn import:
 *   1. persistImportedPosts inserted posts without the NOT-NULL `pillar` column,
 *      so every imported historical post was silently dropped (23502).
 *   2. /api/voice-lab/analyze did a raw JSON.parse on model output and 500'd
 *      whenever the model emitted malformed JSON (missing comma between array
 *      elements).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseLlmJson, extractJsonObject } from '@/lib/llm-json';

// ---------------------------------------------------------------------------
// parseLlmJson / extractJsonObject
// ---------------------------------------------------------------------------

describe('Phase: Voice Import - parseLlmJson', () => {
  it('parses a bare JSON object', () => {
    expect(parseLlmJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips markdown fences', () => {
    expect(parseLlmJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('ignores trailing prose after the object', () => {
    expect(parseLlmJson('{"a":1}\n\nHope that helps!')).toEqual({ a: 1 });
  });

  it('does not truncate on braces inside string values', () => {
    expect(parseLlmJson('{"note":"use {curly} braces"}')).toEqual({ note: 'use {curly} braces' });
  });

  it('returns null (never throws) on malformed JSON - the analyze failure mode', () => {
    // Missing comma between array elements - the exact defect from production.
    expect(parseLlmJson('{"rules":["a" "b"]}')).toBeNull();
  });

  it('returns null when no object is present', () => {
    expect(parseLlmJson('no json here')).toBeNull();
  });

  it('extractJsonObject returns the balanced substring', () => {
    expect(extractJsonObject('prefix {"a":{"b":2}} suffix')).toBe('{"a":{"b":2}}');
  });
});

// ---------------------------------------------------------------------------
// persistImportedPosts - pillar bug
// ---------------------------------------------------------------------------

vi.mock('@/lib/insforge/server', () => ({
  getAuthenticatedUser: vi.fn(),
  getServerClient: vi.fn(),
}));

/** DB mock capturing the posts insert payload; publish_jobs is a no-op stub. */
function makePersistClient(postsInsertCalls: unknown[][]) {
  const from = vi.fn((table: string) => {
    if (table === 'publish_jobs') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [] }),
        insert: vi.fn().mockResolvedValue({ error: null }),
      };
    }
    // posts
    return {
      insert: vi.fn((rows: unknown[]) => {
        postsInsertCalls.push(rows);
        return Promise.resolve({ error: null });
      }),
    };
  });
  return { database: { from } };
}

describe('Phase: Voice Import - persistImportedPosts', () => {
  it('inserts imported posts with pillar seeded so the row is not rejected', async () => {
    const postsInsertCalls: unknown[][] = [];
    const { persistImportedPosts } = await import('@/lib/voice-lab/persist-imported-posts');

    await persistImportedPosts({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: makePersistClient(postsInsertCalls) as any,
      userId: 'user_1',
      workspaceId: 'ws_1',
      platform: 'linkedin',
      items: [{ id: 'p1', text: 'A genuine original post with enough length to pass the filter.' }],
    });

    expect(postsInsertCalls).toHaveLength(1);
    const row = (postsInsertCalls[0][0] as Record<string, unknown>);
    // Regression: pillar must be present and non-null (NOT NULL, no default).
    expect(row.pillar).toBe('general');
    expect(row.pillar).not.toBeNull();
    expect(row.status).toBe('posted');
    expect(row.user_id).toBe('user_1');
  });
});

// ---------------------------------------------------------------------------
// /api/voice-lab/analyze - malformed-JSON resilience
// ---------------------------------------------------------------------------

// isLlmConfigured() false → generatePostTitle (import path) uses the deterministic
// slice fallback instead of an LLM call; describeImage covered for image-carrying items.
vi.mock('@/lib/llm', () => ({
  chatCompletion: vi.fn(),
  isLlmConfigured: vi.fn(() => false),
  describeImage: vi.fn(),
}));
vi.mock('@/lib/ai-guard', () => ({ guardAiRequest: vi.fn().mockResolvedValue({ ok: true }) }));

import { getAuthenticatedUser } from '@/lib/insforge/server';
import { chatCompletion } from '@/lib/llm';
import { NextRequest } from 'next/server';

const VALID_JSON = JSON.stringify({ analysis: { tone: 'punchy' }, voice_summary: 'x', voice_rules: [] });
const MALFORMED_JSON = '{"analysis":{"tone":"punchy"},"voice_rules":["a" "b"]}'; // missing comma

function analyzeRequest() {
  return new NextRequest('http://localhost/api/voice-lab/analyze', {
    method: 'POST',
    body: JSON.stringify({ samples: [{ content: 'Sample post content here.' }] }),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Phase: Voice Import - analyze route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (getAuthenticatedUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 'user_1', email: 'a@b.co' });
  });

  it('returns 200 on well-formed model JSON (single call)', async () => {
    (chatCompletion as ReturnType<typeof vi.fn>).mockResolvedValue(VALID_JSON);
    const { POST } = await import('@/app/api/voice-lab/analyze/route');
    const res = await POST(analyzeRequest());
    expect(res.status).toBe(200);
    expect(chatCompletion).toHaveBeenCalledTimes(1);
  });

  it('retries once and succeeds when the first response is malformed', async () => {
    (chatCompletion as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(MALFORMED_JSON)
      .mockResolvedValueOnce(VALID_JSON);
    const { POST } = await import('@/app/api/voice-lab/analyze/route');
    const res = await POST(analyzeRequest());
    expect(res.status).toBe(200);
    expect(chatCompletion).toHaveBeenCalledTimes(2);
  });

  it('returns 500 (not a raw crash) when both attempts are malformed', async () => {
    (chatCompletion as ReturnType<typeof vi.fn>).mockResolvedValue(MALFORMED_JSON);
    const { POST } = await import('@/app/api/voice-lab/analyze/route');
    const res = await POST(analyzeRequest());
    expect(res.status).toBe(500);
    expect(chatCompletion).toHaveBeenCalledTimes(2);
  });
});
