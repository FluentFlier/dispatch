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
 * If LLM_* is unset, HUGGINGFACE_API_KEY auto-configures the HF router as the
 * primary provider (experimentation default). Swap to OpenAI by setting LLM_*;
 * HF remains an automatic failover when configured.
 */

/** Hugging Face OpenAI-compatible router — default experimentation provider. */
export const HF_ROUTER_BASE_URL = 'https://router.huggingface.co/v1';
export const HF_DEFAULT_CHAT_MODEL = 'meta-llama/Llama-3.1-8B-Instruct';

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
  /**
   * Ask the provider for a guaranteed-JSON response (response_format
   * json_object). Providers that reject the param 400 - the call is retried
   * once without it, so setting this is always safe.
   */
  responseFormat?: 'json';
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
 * Returns true when a chat provider is available: explicit LLM_* env, or
 * HUGGINGFACE_API_KEY alone (auto-routes through the HF router).
 */
export function isLlmConfigured(): boolean {
  const hfKey = process.env.HUGGINGFACE_API_KEY?.trim();
  const url = process.env.LLM_BASE_URL?.trim();
  const model = process.env.LLM_MODEL?.trim();
  const key = process.env.LLM_API_KEY?.trim() || hfKey;
  if (url && model && key) return true;
  return Boolean(hfKey);
}

interface Provider {
  baseUrl: string;
  apiKey: string;
  model: string;
  label: string;
}

/** Primary provider: explicit LLM_* env, else Hugging Face when HF key is set. */
function getPrimaryProvider(modelOverride?: string): Provider | null {
  const hfKey = process.env.HUGGINGFACE_API_KEY?.trim();
  const explicitUrl = process.env.LLM_BASE_URL?.trim();
  const explicitModel = process.env.LLM_MODEL?.trim();
  const explicitKey = process.env.LLM_API_KEY?.trim() || hfKey;

  if (explicitUrl && explicitModel && explicitKey) {
    return {
      baseUrl: explicitUrl.replace(/\/+$/, ''),
      apiKey: explicitKey,
      model: modelOverride ?? explicitModel,
      label: 'primary',
    };
  }

  if (hfKey) {
    return {
      baseUrl: HF_ROUTER_BASE_URL,
      apiKey: hfKey,
      model: modelOverride ?? explicitModel ?? HF_DEFAULT_CHAT_MODEL,
      label: 'huggingface',
    };
  }

  return null;
}

/**
 * Fallback provider used when the primary is quota/rate-limited (402/429).
 * Explicit LLM_FALLBACK_* env wins; otherwise defaults to the HuggingFace
 * OpenAI-compatible router when HUGGINGFACE_API_KEY is present. Returns null
 * when no fallback is available.
 */
function getFallbackProvider(primary: Provider | null): Provider | null {
  if (process.env.LLM_FALLBACK_BASE_URL && process.env.LLM_FALLBACK_API_KEY && process.env.LLM_FALLBACK_MODEL) {
    return {
      baseUrl: process.env.LLM_FALLBACK_BASE_URL.replace(/\/+$/, ''),
      apiKey: process.env.LLM_FALLBACK_API_KEY,
      model: process.env.LLM_FALLBACK_MODEL,
      label: 'fallback',
    };
  }
  // HF is already primary — don't use it as its own fallback.
  if (primary?.label === 'huggingface') return null;
  if (process.env.HUGGINGFACE_API_KEY) {
    return {
      baseUrl: HF_ROUTER_BASE_URL,
      apiKey: process.env.HUGGINGFACE_API_KEY,
      model: process.env.LLM_FALLBACK_MODEL ?? HF_DEFAULT_CHAT_MODEL,
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
  if (options.responseFormat === 'json') {
    body.response_format = { type: 'json_object' };
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
 * callProvider + one graceful degradation: providers that don't support
 * response_format reject it with a 400. Retry once without it so json mode
 * is safe to request against any OpenAI-compatible endpoint.
 */
async function callProviderWithJsonFallback(
  provider: Provider,
  systemPrompt: string,
  userPrompt: string,
  options: ChatCompletionOptions,
  retryRateLimit: boolean,
): Promise<string> {
  try {
    return await callProvider(provider, systemPrompt, userPrompt, options, retryRateLimit);
  } catch (err) {
    if (err instanceof LlmError && err.status === 400 && options.responseFormat) {
      return callProvider(
        provider,
        systemPrompt,
        userPrompt,
        { ...options, responseFormat: undefined },
        retryRateLimit,
      );
    }
    throw err;
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
/**
 * Live auth/connectivity probe for the configured LLM provider. Runs one tiny
 * chat completion so a health check can distinguish "key present" from "key
 * actually works" — presence checks stay green even when the key is empty/wrong,
 * which is exactly how a prod 401 stayed invisible. Returns 'skipped' when no
 * provider is configured, 'ok' on a valid completion, 'error' on any failure.
 */
export async function pingLlm(): Promise<'ok' | 'error' | 'skipped'> {
  if (!isLlmConfigured()) return 'skipped';
  try {
    const out = await chatCompletion('Reply with the single word ok.', 'ok', { maxTokens: 5 });
    return out.trim().length > 0 ? 'ok' : 'error';
  } catch {
    return 'error';
  }
}

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
    // No provider configured -> legacy HuggingFace SDK path (last resort).
    return generateContentHF(systemPrompt, userPrompt);
  }

  const fallback = getFallbackProvider(primary);
  try {
    // If a fallback exists, don't waste time retrying a rate-limited primary —
    // fail fast and switch. Without a fallback, keep the in-place retry loop.
    return await callProviderWithJsonFallback(primary, systemPrompt, userPrompt, options, !fallback);
  } catch (err) {
    // On quota/credit/rate-limit exhaustion, try the fallback provider.
    if (err instanceof LlmError && err.isQuota && fallback) {
      // Use the fallback's own model, not the primary's override.
      return callProviderWithJsonFallback(fallback, systemPrompt, userPrompt, { ...options, model: undefined }, true);
    }
    throw err;
  }
}

/** Called for each text delta as it streams in. */
export type StreamTokenHandler = (delta: string) => void;

/**
 * Streams a chat completion from a specific provider, invoking `onToken` for
 * every content delta and returning the fully accumulated text. Parses the
 * OpenAI-compatible SSE format (`data: {json}\n\n`, terminated by `[DONE]`),
 * which Groq, OpenAI, Together, Fireworks and the HuggingFace router all speak.
 */
async function callProviderStream(
  provider: Provider,
  systemPrompt: string,
  userPrompt: string,
  options: ChatCompletionOptions,
  onToken: StreamTokenHandler,
): Promise<string> {
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const body: Record<string, unknown> = {
    model: provider.model,
    stream: true,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  };
  if (isReasoningModel(provider.model)) {
    body.max_completion_tokens = maxTokens;
  } else {
    body.max_tokens = maxTokens;
    body.temperature = options.temperature ?? DEFAULT_TEMPERATURE;
  }

  let response: Response;
  try {
    response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${provider.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new LlmError(
      `LLM request failed: ${err instanceof Error ? err.message : String(err)}`,
      503,
    );
  }

  if (!response.ok || !response.body) {
    const bodyText = await response.text().catch(() => '');
    let detail = bodyText;
    try {
      const parsed = JSON.parse(bodyText);
      detail = parsed?.error?.message ?? parsed?.error ?? bodyText.slice(0, 200);
    } catch {
      detail = bodyText.slice(0, 200);
    }
    throw new LlmError(`LLM provider returned ${response.status}: ${detail}`, response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  const consume = (chunk: string): void => {
    buffer += chunk;
    // SSE events are newline-delimited; keep the trailing partial line buffered.
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        const json = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = json.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          full += delta;
          onToken(delta);
        }
      } catch {
        // Ignore malformed/partial JSON — the next chunk completes it.
      }
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    consume(decoder.decode(value, { stream: true }));
  }
  consume(decoder.decode());

  if (!full) throw new LlmError('Empty streamed response from LLM provider', 502);
  return full;
}

/**
 * Streaming counterpart to {@link chatCompletion}. Invokes `onToken` for every
 * delta and resolves with the full text. Degrades gracefully: on quota it fails
 * over to the fallback provider, and if streaming is unavailable (no provider or
 * a non-quota transport error before any token) it falls back to a single
 * non-streamed completion and emits the whole result at once — so callers always
 * get text and never have to special-case provider capabilities.
 */
export async function chatCompletionStream(
  systemPrompt: string,
  userPrompt: string,
  options: ChatCompletionOptions,
  onToken: StreamTokenHandler,
): Promise<string> {
  if ((await checkGlobalLlmBudget()) === 'blocked') {
    throw new LlmError('Global daily AI budget reached. Generation paused to protect credits.', 429);
  }

  const primary = getPrimaryProvider(options.model);
  if (!primary) {
    const text = await generateContentHF(systemPrompt, userPrompt);
    if (text) onToken(text);
    return text;
  }

  const fallback = getFallbackProvider(primary);
  let emitted = 0;
  const counted: StreamTokenHandler = (delta) => {
    emitted += 1;
    onToken(delta);
  };

  try {
    return await callProviderStream(primary, systemPrompt, userPrompt, options, counted);
  } catch (err) {
    // Only recover if nothing has streamed yet — otherwise we'd duplicate output.
    if (emitted === 0) {
      if (err instanceof LlmError && err.isQuota && fallback) {
        return callProviderStream(fallback, systemPrompt, userPrompt, { ...options, model: undefined }, counted);
      }
      // Non-quota transport failure (e.g. provider without SSE support): fall
      // back to a single blocking completion so the user still gets a draft.
      const text = await chatCompletion(systemPrompt, userPrompt, options);
      if (text) onToken(text);
      return text;
    }
    throw err;
  }
}
