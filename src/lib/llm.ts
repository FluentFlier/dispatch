import { generateContentHF } from '@/lib/huggingface';

/**
 * Provider-agnostic LLM client.
 *
 * WHY: text generation must be swappable between providers (Groq for testing,
 * OpenAI/Claude for production, HuggingFace as a fallback) WITHOUT touching code.
 * Every mainstream provider exposes an OpenAI-compatible `/chat/completions`
 * endpoint (Groq, OpenAI, Together, Fireworks, the InsForge AI gateway, and even
 * HuggingFace via `router.huggingface.co/v1`), so a single fetch-based client
 * driven by three env vars covers all of them. No provider name is hardcoded.
 *
 * Configure via env (see .env.example):
 *   LLM_BASE_URL  e.g. https://api.groq.com/openai/v1
 *   LLM_API_KEY   the provider key
 *   LLM_MODEL     e.g. llama-3.3-70b-versatile
 *
 * If those are not set, calls fall back to the legacy HuggingFace path so the
 * app keeps working during migration.
 */

const DEFAULT_MAX_TOKENS = 1024;
const DEFAULT_TEMPERATURE = 0.7;

/** Options for a single chat completion. All optional. */
export interface ChatCompletionOptions {
  maxTokens?: number;
  temperature?: number;
  /** Override the env model for this call (rarely needed). */
  model?: string;
}

/**
 * Typed error for LLM failures. Carries the HTTP status so callers can decide
 * how to degrade (e.g. skip evaluation on quota exhaustion instead of 500ing).
 */
export class LlmError extends Error {
  readonly status: number;
  /** True when the failure is a quota/credit/rate-limit condition (402/429). */
  readonly isQuota: boolean;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'LlmError';
    this.status = status;
    this.isQuota = status === 402 || status === 429;
  }
}

/**
 * Returns true when a generic OpenAI-compatible provider is configured via env.
 * When false, callers fall back to the legacy HuggingFace client.
 */
export function isLlmConfigured(): boolean {
  return Boolean(
    process.env.LLM_BASE_URL && process.env.LLM_API_KEY && process.env.LLM_MODEL,
  );
}

/**
 * Runs a single chat completion against the configured OpenAI-compatible provider.
 * Falls back to HuggingFace when no generic provider is configured.
 *
 * Signature mirrors the legacy `generateContentHF(systemPrompt, userPrompt)` so
 * call sites can swap to this with no shape changes.
 */
export async function chatCompletion(
  systemPrompt: string,
  userPrompt: string,
  options: ChatCompletionOptions = {},
): Promise<string> {
  // Fallback path: no generic provider configured yet -> use HuggingFace.
  if (!isLlmConfigured()) {
    return generateContentHF(systemPrompt, userPrompt);
  }

  const baseUrl = (process.env.LLM_BASE_URL as string).replace(/\/+$/, '');
  const apiKey = process.env.LLM_API_KEY as string;
  const model = options.model ?? (process.env.LLM_MODEL as string);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
        temperature: options.temperature ?? DEFAULT_TEMPERATURE,
      }),
    });
  } catch (err) {
    // Network-level failure (DNS, timeout, refused). Surface as a 503-style error.
    throw new LlmError(
      `LLM request failed: ${err instanceof Error ? err.message : String(err)}`,
      503,
    );
  }

  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.error?.message ?? body?.error ?? JSON.stringify(body).slice(0, 200);
    } catch {
      detail = await response.text().catch(() => '');
    }
    throw new LlmError(
      `LLM provider returned ${response.status}: ${detail}`,
      response.status,
    );
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new LlmError('Empty response from LLM provider', 502);
  }

  return content;
}
