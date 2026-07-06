import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests the provider-agnostic LLM client. Verifies env-driven configuration,
 * the HuggingFace fallback when unconfigured, the OpenAI-compatible request
 * shape, and typed quota error handling.
 */

// Mock the HF fallback so we can assert it's used when LLM_* is unconfigured.
vi.mock('@/lib/huggingface', () => ({
  generateContentHF: vi.fn(async () => 'HF_FALLBACK_OUTPUT'),
}));

const ENV_KEYS = ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL', 'HUGGINGFACE_API_KEY'] as const;

function clearLlmEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
}

function setLlmEnv() {
  process.env.LLM_BASE_URL = 'https://api.groq.com/openai/v1';
  process.env.LLM_API_KEY = 'test-key';
  process.env.LLM_MODEL = 'llama-3.3-70b-versatile';
}

describe('LLM provider abstraction', () => {
  beforeEach(() => {
    vi.resetModules();
    clearLlmEnv();
  });

  afterEach(() => {
    clearLlmEnv();
    vi.restoreAllMocks();
  });

  describe('isLlmConfigured', () => {
    it('is false when env vars are missing', async () => {
      const { isLlmConfigured } = await import('@/lib/llm');
      expect(isLlmConfigured()).toBe(false);
    });

    it('is true when all three LLM env vars are set', async () => {
      setLlmEnv();
      const { isLlmConfigured } = await import('@/lib/llm');
      expect(isLlmConfigured()).toBe(true);
    });

    it('is true when only HUGGINGFACE_API_KEY is set', async () => {
      process.env.HUGGINGFACE_API_KEY = 'hf-key';
      const { isLlmConfigured } = await import('@/lib/llm');
      expect(isLlmConfigured()).toBe(true);
    });
  });

  describe('chatCompletion', () => {
    it('uses the Hugging Face router when only HUGGINGFACE_API_KEY is set', async () => {
      process.env.HUGGINGFACE_API_KEY = 'hf-key';
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'HF_ROUTER_OUTPUT' } }] }),
      })) as unknown as typeof fetch;
      vi.stubGlobal('fetch', fetchMock);

      const { chatCompletion } = await import('@/lib/llm');
      const out = await chatCompletion('sys', 'user');

      expect(out).toBe('HF_ROUTER_OUTPUT');
      const [url] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe('https://router.huggingface.co/v1/chat/completions');
    });

    it('falls back to legacy HuggingFace SDK when no provider is configured', async () => {
      const { chatCompletion } = await import('@/lib/llm');
      const { generateContentHF } = await import('@/lib/huggingface');
      const out = await chatCompletion('sys', 'user');
      expect(out).toBe('HF_FALLBACK_OUTPUT');
      expect(generateContentHF).toHaveBeenCalledWith('sys', 'user');
    });

    it('posts to {baseUrl}/chat/completions and returns content', async () => {
      setLlmEnv();
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'GROQ_OUTPUT' } }] }),
      })) as unknown as typeof fetch;
      vi.stubGlobal('fetch', fetchMock);

      const { chatCompletion } = await import('@/lib/llm');
      const out = await chatCompletion('sys', 'user');

      expect(out).toBe('GROQ_OUTPUT');
      const [url, opts] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
      const sentBody = JSON.parse((opts as RequestInit).body as string);
      expect(sentBody.model).toBe('llama-3.3-70b-versatile');
      expect(sentBody.messages).toEqual([
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'user' },
      ]);
      expect((opts as RequestInit).headers).toMatchObject({
        Authorization: 'Bearer test-key',
      });
    });

    it('throws a quota-flagged LlmError on 402 (not retried)', async () => {
      setLlmEnv();
      const fetchMock = vi.fn(async () => ({
        ok: false,
        status: 402,
        headers: { get: () => null },
        text: async () => JSON.stringify({ error: { message: 'depleted credits' } }),
      })) as unknown as typeof fetch;
      vi.stubGlobal('fetch', fetchMock);

      const { chatCompletion, LlmError } = await import('@/lib/llm');
      const caught = await chatCompletion('sys', 'user').catch((e) => e);
      expect(caught).toBeInstanceOf(LlmError);
      expect(caught.status).toBe(402);
      expect(caught.isQuota).toBe(true);
      // 402 must NOT be retried — exactly one call.
      expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    });

    it('retries 429 then throws a quota error when it never clears', async () => {
      setLlmEnv();
      const fetchMock = vi.fn(async () => ({
        ok: false,
        status: 429,
        headers: { get: () => '0' }, // Retry-After: 0s -> fast backoff
        text: async () => JSON.stringify({ error: { message: 'rate limited' } }),
      })) as unknown as typeof fetch;
      vi.stubGlobal('fetch', fetchMock);

      const { chatCompletion } = await import('@/lib/llm');
      const caught = await chatCompletion('s', 'u').catch((e) => e);
      expect(caught.status).toBe(429);
      expect(caught.isQuota).toBe(true);
      // Initial attempt + 4 retries = 5 calls.
      expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(5);
    });

    it('retries 429 then succeeds when a later attempt clears', async () => {
      setLlmEnv();
      let calls = 0;
      const fetchMock = vi.fn(async () => {
        calls++;
        if (calls < 3) {
          return {
            ok: false,
            status: 429,
            headers: { get: () => '0' },
            text: async () => '{"error":"rate limited"}',
          };
        }
        return { ok: true, json: async () => ({ choices: [{ message: { content: 'RECOVERED' } }] }) };
      }) as unknown as typeof fetch;
      vi.stubGlobal('fetch', fetchMock);

      const { chatCompletion } = await import('@/lib/llm');
      const out = await chatCompletion('s', 'u');
      expect(out).toBe('RECOVERED');
      expect(calls).toBe(3);
    });

    it('does not retry a 500 (non-quota)', async () => {
      setLlmEnv();
      const fetchMock = vi.fn(async () => ({
        ok: false,
        status: 500,
        headers: { get: () => null },
        text: async () => 'server error',
      })) as unknown as typeof fetch;
      vi.stubGlobal('fetch', fetchMock);

      const { chatCompletion } = await import('@/lib/llm');
      const e500 = await chatCompletion('s', 'u').catch((e) => e);
      expect(e500.isQuota).toBe(false);
      expect(e500.status).toBe(500);
      expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    });

    it('strips a trailing slash from LLM_BASE_URL', async () => {
      setLlmEnv();
      process.env.LLM_BASE_URL = 'https://api.groq.com/openai/v1/';
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
      })) as unknown as typeof fetch;
      vi.stubGlobal('fetch', fetchMock);

      const { chatCompletion } = await import('@/lib/llm');
      await chatCompletion('s', 'u');
      const [url] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    });
  });
});
