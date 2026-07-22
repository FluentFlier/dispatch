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

const ENV_KEYS = [
  'LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL', 'HUGGINGFACE_API_KEY',
  'LLM_GENERATE_BASE_URL', 'LLM_GENERATE_API_KEY', 'LLM_GENERATE_MODEL',
  'LLM_JUDGE_BASE_URL', 'LLM_JUDGE_API_KEY', 'LLM_JUDGE_MODEL',
  'LLM_SMALL_BASE_URL', 'LLM_SMALL_API_KEY', 'LLM_SMALL_MODEL',
] as const;

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
      // 402 must NOT be retried - exactly one call.
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
      // Initial attempt + 2 retries = 3 calls (spec 3.4: max 2 retries).
      expect((fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(3);
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

    it('routes options.role to the role-specific endpoint (LLM_GENERATE_*)', async () => {
      setLlmEnv(); // global primary = Groq
      process.env.LLM_GENERATE_BASE_URL = 'https://api.openai.com/v1';
      process.env.LLM_GENERATE_API_KEY = 'openai-key';
      process.env.LLM_GENERATE_MODEL = 'gpt-5.5';
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'GEN_OUTPUT' } }] }),
      })) as unknown as typeof fetch;
      vi.stubGlobal('fetch', fetchMock);

      const { chatCompletion } = await import('@/lib/llm');
      const out = await chatCompletion('sys', 'user', { role: 'generate' });

      expect(out).toBe('GEN_OUTPUT');
      const [url, opts] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      const body = JSON.parse((opts as RequestInit).body as string);
      expect(body.model).toBe('gpt-5.5');
      expect((opts as RequestInit).headers).toMatchObject({ Authorization: 'Bearer openai-key' });
    });

    it('keeps judge calls on the judge provider inside a selected Write model context', async () => {
      setLlmEnv();
      process.env.LLM_JUDGE_BASE_URL = 'https://judge.example/v1';
      process.env.LLM_JUDGE_API_KEY = 'judge-key';
      process.env.LLM_JUDGE_MODEL = 'judge-model';
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'JUDGED' } }] }),
      })) as unknown as typeof fetch;
      vi.stubGlobal('fetch', fetchMock);

      const { chatCompletion } = await import('@/lib/llm');
      const { withWriteModel } = await import('@/lib/write-models');
      await withWriteModel(
        { id: 'custom', label: 'Custom', baseUrl: 'https://write.example/v1', apiKey: 'write-key', model: 'write-model' },
        () => chatCompletion('sys', 'user', { role: 'judge' }),
      );

      const [url, opts] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe('https://judge.example/v1/chat/completions');
      expect(JSON.parse((opts as RequestInit).body as string).model).toBe('judge-model');
    });

    it('falls back to the global primary when the role env triplet is unset', async () => {
      setLlmEnv(); // only global primary configured; no LLM_JUDGE_*
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'PRIMARY' } }] }),
      })) as unknown as typeof fetch;
      vi.stubGlobal('fetch', fetchMock);

      const { chatCompletion } = await import('@/lib/llm');
      const out = await chatCompletion('sys', 'user', { role: 'judge' });

      expect(out).toBe('PRIMARY');
      const [url, opts] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
      expect(JSON.parse((opts as RequestInit).body as string).model).toBe('llama-3.3-70b-versatile');
    });

    it('treats a partial role triplet (missing model) as unconfigured', async () => {
      setLlmEnv();
      process.env.LLM_SMALL_BASE_URL = 'https://api.cerebras.ai/v1';
      process.env.LLM_SMALL_API_KEY = 'cere-key';
      // LLM_SMALL_MODEL intentionally unset -> must fall back to global primary.
      const fetchMock = vi.fn(async () => ({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'PRIMARY2' } }] }),
      })) as unknown as typeof fetch;
      vi.stubGlobal('fetch', fetchMock);

      const { chatCompletion } = await import('@/lib/llm');
      await chatCompletion('sys', 'user', { role: 'small' });
      const [url] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
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
