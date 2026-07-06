import { generateContentHF } from '@/lib/huggingface';
import { checkGlobalLlmBudget } from '@/lib/llm-budget';

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
 * OpenAI reasoning models (o-series and the GPT-5 family, e.g. gpt-5.4-mini)
 * change the chat-completions contract: they reject the classic `max_tokens`
 * param (require `max_completion_tokens`) and only accept the default
 * temperature (sending 0 or 0.7 returns 400). Detect them so we build a
 * compatible request body. Classic chat models (gpt-4o, Llama on the HF
 * router, Groq) keep the old `max_tokens` + `temperature` shape.
 */
function isReasoningModel(model: string): boolean {
  return /(^|\/)o\d/i.test(model) || /gpt-5/i.test(model);
}

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

interface Provider {
  baseUrl: string;
  apiKey: string;
  model: string;
  label: string;
}

/** Primary provider from LLM_* env (e.g. Groq). `modelOverride` wins over LLM_MODEL. */
function getPrimaryProvider(modelOverride?: string): Provider | null {
  if (!isLlmConfigured()) return null;
  return {
    baseUrl: (process.env.LLM_BASE_URL as string).replace(/\/+$/, ''),
    apiKey: process.env.LLM_API_KEY as string,
    model: modelOverride ?? (process.env.LLM_MODEL as string),
    label: 'primary',
  };
}

/**
 * Fallback provider used when the primary is quota/rate-limited (402/429).
 * Explicit LLM_FALLBACK_* env wins; otherwise defaults to the HuggingFace
 * OpenAI-compatible router when HUGGINGFACE_API_KEY is present. Returns null
 * when no fallback is available.
 */
function getFallbackProvider(): Provider | null {
  if (process.env.LLM_FALLBACK_BASE_URL && process.env.LLM_FALLBACK_API_KEY && process.env.LLM_FALLBACK_MODEL) {
    return {
      baseUrl: process.env.LLM_FALLBACK_BASE_URL.replace(/\/+$/, ''),
      apiKey: process.env.LLM_FALLBACK_API_KEY,
      model: process.env.LLM_FALLBACK_MODEL,
      label: 'fallback',
    };
  }
  if (process.env.HUGGINGFACE_API_KEY) {
    return {
      baseUrl: 'https://router.huggingface.co/v1',
      apiKey: process.env.HUGGINGFACE_API_KEY,
      model: process.env.LLM_FALLBACK_MODEL ?? 'meta-llama/Llama-3.1-8B-Instruct',
      label: 'fallback-hf',
    };
  }
  return null;
}

/**
 * Run one chat completion against a specific provider. `retryRateLimit` controls
 * whether a 429 is retried in place with backoff — we disable it when a fallback
 * provider exists so we fail over immediately instead of waiting out a (possibly
 * multi-minute) daily-limit backoff on the primary.
 */
async function callProvider(
  provider: Provider,
  systemPrompt: string,
  userPrompt: string,
  options: ChatCompletionOptions,
  retryRateLimit = true,
): Promise<string> {
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const body: Record<string, unknown> = {
    model: provider.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  };
  if (isReasoningModel(provider.model)) {
    // Reasoning models: new token param, and no custom temperature.
    body.max_completion_tokens = maxTokens;
  } else {
    body.max_tokens = maxTokens;
    body.temperature = options.temperature ?? DEFAULT_TEMPERATURE;
  }
  const requestBody = JSON.stringify(body);

  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${provider.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: requestBody,
      });
    } catch (err) {
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
    if (retryRateLimit && response.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
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

/**
 * Runs a chat completion against the configured provider, automatically failing
 * over to the fallback provider (HuggingFace by default) when the primary is
 * quota/rate-limited. Falls back to the legacy HuggingFace client when no
 * generic provider is configured.
 *
 * Signature mirrors the legacy `generateContentHF(systemPrompt, userPrompt)` so
 * call sites can swap to this with no shape changes.
 */
export async function chatCompletion(
  systemPrompt: string,
  userPrompt: string,
  options: ChatCompletionOptions = {},
): Promise<string> {
  // Global spend backstop — runs before ANY provider (primary or HF fallback),
  // so every text-gen path in the app (generate, signals, leads, crons) is
  // bounded by one deployment-wide daily cap. Inert unless LLM_DAILY_HARD_CAP set.
  if ((await checkGlobalLlmBudget()) === 'blocked') {
    throw new LlmError('Global daily AI budget reached. Generation paused to protect credits.', 429);
  }

  const primary = getPrimaryProvider(options.model);
  if (!primary) {
    // No generic provider configured -> legacy HuggingFace path.
    return generateContentHF(systemPrompt, userPrompt);
  }

  const fallback = getFallbackProvider();
  try {
    // If a fallback exists, don't waste time retrying a rate-limited primary —
    // fail fast and switch. Without a fallback, keep the in-place retry loop.
    return await callProvider(primary, systemPrompt, userPrompt, options, !fallback);
  } catch (err) {
    // On quota/credit/rate-limit exhaustion, try the fallback provider.
    if (err instanceof LlmError && err.isQuota && fallback) {
      // Use the fallback's own model, not the primary's override.
      return callProvider(fallback, systemPrompt, userPrompt, { ...options, model: undefined });
    }
    throw err;
  }
}
