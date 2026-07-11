/**
 * Phase: Niche Hooks - OpenAI embeddings helper.
 * text-embedding-3-small at 512 dims is the ONE provider-locked call. We test
 * the loud env check and the request shape (dimensions param, pgvector literal)
 * with a mocked fetch - never a live network call in unit tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const OLD = { ...process.env };
beforeEach(() => { vi.resetModules(); process.env = { ...OLD }; });
afterEach(() => { process.env = { ...OLD }; vi.unstubAllGlobals(); });

describe('embeddingsKey', () => {
  it('prefers OPENAI_EMBEDDINGS_KEY then OPENAI_API_KEY', async () => {
    process.env.OPENAI_EMBEDDINGS_KEY = 'sk-embed';
    process.env.OPENAI_API_KEY = 'sk-general';
    const { embeddingsKey } = await import('@/lib/embeddings');
    expect(embeddingsKey()).toBe('sk-embed');
  });
  it('falls back to OPENAI_API_KEY', async () => {
    delete process.env.OPENAI_EMBEDDINGS_KEY;
    process.env.OPENAI_API_KEY = 'sk-general';
    const { embeddingsKey } = await import('@/lib/embeddings');
    expect(embeddingsKey()).toBe('sk-general');
  });
  it('throws loudly when neither is set', async () => {
    delete process.env.OPENAI_EMBEDDINGS_KEY;
    delete process.env.OPENAI_API_KEY;
    const { embeddingsKey } = await import('@/lib/embeddings');
    expect(() => embeddingsKey()).toThrow(/OPENAI_EMBEDDINGS_KEY/);
  });
});

describe('embedBatch', () => {
  it('requests 512 dims and returns one vector per input', async () => {
    process.env.OPENAI_EMBEDDINGS_KEY = 'sk-embed';
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('text-embedding-3-small');
      expect(body.dimensions).toBe(512);
      expect(body.input).toHaveLength(2);
      return new Response(JSON.stringify({
        data: [{ index: 0, embedding: Array(512).fill(0.1) }, { index: 1, embedding: Array(512).fill(0.2) }],
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { embedBatch, EMBED_DIM } = await import('@/lib/embeddings');
    const out = await embedBatch(['a', 'b']);
    expect(out).toHaveLength(2);
    expect(out[0]).toHaveLength(EMBED_DIM);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('restores input order when response data is out of order', async () => {
    process.env.OPENAI_EMBEDDINGS_KEY = 'sk-embed';
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      // Simulate OpenAI returning data out of order with index field
      return new Response(JSON.stringify({
        data: [
          { index: 1, embedding: Array(512).fill(0.2) },
          { index: 0, embedding: Array(512).fill(0.1) },
        ],
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const { embedBatch } = await import('@/lib/embeddings');
    const out = await embedBatch(['a', 'b']);
    // Verify order is restored to match input order, not response order
    expect(out).toHaveLength(2);
    expect(out[0][0]).toBe(0.1);
    expect(out[1][0]).toBe(0.2);
  });
});

describe('toPgVector', () => {
  it('serializes to a bracketed literal with no spaces', async () => {
    const { toPgVector } = await import('@/lib/embeddings');
    expect(toPgVector([0.5, -0.25, 1])).toBe('[0.5,-0.25,1]');
  });
});
