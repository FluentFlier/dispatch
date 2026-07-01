/**
 * Phase: LLM cost + failover
 *
 * Verifies chatCompletion fails over from the primary provider (Groq) to the
 * HuggingFace router when the primary is quota/rate-limited (402/429), and does
 * NOT fail over on non-quota errors.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/huggingface', () => ({
  generateContentHF: vi.fn().mockResolvedValue('hf-legacy'),
}));

import { chatCompletion } from '@/lib/llm';

const OLD_ENV = { ...process.env };

function res(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  });
}

beforeEach(() => {
  process.env.LLM_BASE_URL = 'https://api.groq.com/openai/v1';
  process.env.LLM_API_KEY = 'groq-key';
  process.env.LLM_MODEL = 'llama-3.3-70b-versatile';
  process.env.HUGGINGFACE_API_KEY = 'hf-key';
  delete process.env.LLM_FALLBACK_BASE_URL;
  delete process.env.LLM_FALLBACK_API_KEY;
  delete process.env.LLM_FALLBACK_MODEL;
});

afterEach(() => {
  process.env = { ...OLD_ENV };
  vi.restoreAllMocks();
});

describe('Phase: LLM failover', () => {
  it('falls over to the HuggingFace router when the primary is 429', async () => {
    const fetchSpy = vi.fn()
      // primary (Groq) rate-limited
      .mockResolvedValueOnce(res(429, { error: { message: 'daily limit' } }))
      // fallback (HF) succeeds
      .mockResolvedValueOnce(res(200, { choices: [{ message: { content: 'from-hf' } }] }));
    vi.stubGlobal('fetch', fetchSpy);

    const out = await chatCompletion('sys', 'user');
    expect(out).toBe('from-hf');

    // Second call hit the HuggingFace router with the HF key.
    const [url, init] = fetchSpy.mock.calls[1];
    expect(String(url)).toContain('router.huggingface.co');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer hf-key');
  });

  it('does NOT fail over on a non-quota error (500)', async () => {
    const fetchSpy = vi.fn().mockResolvedValueOnce(res(500, { error: { message: 'boom' } }));
    vi.stubGlobal('fetch', fetchSpy);

    await expect(chatCompletion('sys', 'user')).rejects.toThrow(/500/);
    expect(fetchSpy).toHaveBeenCalledTimes(1); // no fallback attempt
  });

  it('throws the original quota error when no fallback is configured', async () => {
    delete process.env.HUGGINGFACE_API_KEY; // no fallback available
    // retry-after 0 keeps the in-place retry loop near-instant for the test.
    const fetchSpy = vi.fn().mockResolvedValue(res(429, { error: { message: 'limit' } }, { 'retry-after': '0' }));
    vi.stubGlobal('fetch', fetchSpy);

    await expect(chatCompletion('sys', 'user')).rejects.toThrow(/429/);
  });
});
