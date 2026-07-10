/**
 * chatCompletion JSON-mode guarantees:
 *   - responseFormat: 'json' adds response_format: { type: 'json_object' } to the body
 *   - a 400 from a provider that rejects response_format triggers ONE retry without it
 *   - no responseFormat -> no response_format key in the body
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/lib/llm-budget', () => ({
  checkGlobalLlmBudget: vi.fn().mockResolvedValue('ok'),
}));
vi.mock('@/lib/huggingface', () => ({
  generateContentHF: vi.fn().mockResolvedValue('hf'),
}));

import { chatCompletion } from '@/lib/llm';

const okResponse = (content = 'hello') =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });

describe('chatCompletion responseFormat json', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    process.env.LLM_BASE_URL = 'https://api.test.dev/v1';
    process.env.LLM_API_KEY = 'k';
    process.env.LLM_MODEL = 'test-model';
    delete process.env.LLM_DAILY_HARD_CAP;
    delete process.env.HUGGINGFACE_API_KEY;
    delete process.env.LLM_FALLBACK_BASE_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends response_format json_object when responseFormat is set', async () => {
    fetchMock.mockResolvedValueOnce(okResponse('{"a":1}'));
    await chatCompletion('sys', 'user', { responseFormat: 'json' });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('omits response_format by default', async () => {
    fetchMock.mockResolvedValueOnce(okResponse());
    await chatCompletion('sys', 'user');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.response_format).toBeUndefined();
  });

  it('retries once WITHOUT response_format on a 400', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('{"error":{"message":"response_format not supported"}}', { status: 400 }))
      .mockResolvedValueOnce(okResponse('{"a":1}'));
    const out = await chatCompletion('sys', 'user', { responseFormat: 'json' });
    expect(out).toBe('{"a":1}');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    expect(secondBody.response_format).toBeUndefined();
  });
});
