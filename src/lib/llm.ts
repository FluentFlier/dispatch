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

/** How many times to retry a 429 (rate limit) before giving up. */
const MAX_RATE_LIMIT_RETRIES = 4;
/** Cap any single backoff wait so a call never hangs too long. */
const MAX_BACKOFF_MS = 12_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Determines how long to wait before retrying a rate-limited request.
 * Honors the provider's hint (Retry-After header or "try again in Xs" in the
 * body) when present, else falls back to exponential backoff. Capped.
 */
function backoffMs(attempt: number, retryAfterHeader: string | null, bodyText: string): number {
  // 1. Retry-After header (seconds)
  const headerSecs = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  if (Number.isFinite(headerSecs) && headerSecs >= 0) {
    return Math.min(headerSecs * 1000 + 250, MAX_BACKOFF_MS);
  }
  // 2. Provider message hint, e.g. "Please try again in 3.6s"
  const match = bodyText.match(/try again in ([\d.]+)\s*s/i);
  if (match) {
    return Math.min(Number(match[1]) * 1000 + 250, MAX_BACKOFF_MS);
  }
  // 3. Exponential backoff: 1s, 2s, 4s, 8s ...
  return Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
}

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

  const requestBody = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: options.temperature ?? DEFAULT_TEMPERATURE,
  });

  // Retry loop: only 429 (rate limit) is retried, honoring the provider's hint.
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: requestBody,
      });
    } catch (err) {
      // Network-level failure (DNS, timeout, refused). Surface as a 503-style error.
      throw new LlmError(
        `LLM request failed: ${err instanceof Error ? err.message : String(err)}`,
        503,
      );
    }

    if (response.ok) {
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new LlmError('Empty response from LLM provider', 502);
      return content;
    }

    const bodyText = await response.text().catch(() => '');

    // Retry rate limits while attempts remain; everything else fails fast.
    if (response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      await sleep(backoffMs(attempt, response.headers.get('retry-after'), bodyText));
      continue;
    }

    let detail = bodyText;
    try {
      const parsed = JSON.parse(bodyText);
      detail = parsed?.error?.message ?? parsed?.error ?? bodyText.slice(0, 200);
    } catch {
      detail = bodyText.slice(0, 200);
    }
    throw new LlmError(`LLM provider returned ${response.status}: ${detail}`, response.status);
  }
}
