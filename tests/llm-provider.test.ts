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

const ENV_KEYS = ['LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL'] as const;

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

    it('is true when all three env vars are set', async () => {
      setLlmEnv();
      const { isLlmConfigured } = await import('@/lib/llm');
      expect(isLlmConfigured()).toBe(true);
    });
  });

  describe('chatCompletion', () => {
    it('falls back to HuggingFace when no provider is configured', async () => {
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

    it('throws a quota-flagged LlmError on 402', async () => {
      setLlmEnv();
      vi.stubGlobal('fetch', vi.fn(async () => ({
        ok: false,
        status: 402,
        json: async () => ({ error: { message: 'depleted credits' } }),
      })) as unknown as typeof fetch);

      const { chatCompletion, LlmError } = await import('@/lib/llm');
      await expect(chatCompletion('sys', 'user')).rejects.toMatchObject({
        name: 'LlmError',
        status: 402,
        isQuota: true,
      });
      // Confirm it is the typed error class.
      const caught = await chatCompletion('sys', 'user').catch((e) => e);
      expect(caught).toBeInstanceOf(LlmError);
    });

    it('flags 429 as quota and 500 as non-quota', async () => {
      setLlmEnv();
      const { chatCompletion } = await import('@/lib/llm');

      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 429, json: async () => ({}) })) as unknown as typeof fetch);
      const e429 = await chatCompletion('s', 'u').catch((e) => e);
      expect(e429.isQuota).toBe(true);

      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch);
      const e500 = await chatCompletion('s', 'u').catch((e) => e);
      expect(e500.isQuota).toBe(false);
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
