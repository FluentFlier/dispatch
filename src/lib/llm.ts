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

/** Hugging Face OpenAI-compatible router - default experimentation provider. */
export const HF_ROUTER_BASE_URL = 'https://router.huggingface.co/v1';
export const HF_DEFAULT_CHAT_MODEL = 'meta-llama/Llama-3.1-8B-Instruct';

const DEFAULT_MAX_TOKENS = 1024;
// Reasoning models (gpt-oss, o-series, gpt-5) spend hundreds of tokens on hidden
// reasoning BEFORE emitting content, so the normal 1024 cap truncates real output
// mid-JSON. Give them headroom by default. This is a ceiling, not spend — billing
// counts only tokens actually generated, and LLM_DAILY_HARD_CAP still guards total.
const REASONING_DEFAULT_MAX_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0.7;

/** How many times to retry a 429 (rate limit) before giving up. */
const MAX_RATE_LIMIT_RETRIES = 2;
/** Cap any single backoff wait so a call never hangs too long. */
const MAX_BACKOFF_MS = 12_000;
/** Floor on every backoff wait - sub-1s backoff is no backoff at all. */
const MIN_BACKOFF_MS = 1_000;

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
  return /(^|\/)o\d/i.test(model) || /gpt-5/i.test(model) || /gpt-oss/i.test(model);
}

/**
 * Determines how long to wait before retrying a rate-limited request.
 * Honors the provider's hint (Retry-After header or "try again in Xs" in the
 * body) when present, else falls back to exponential backoff. Every branch is
 * floored at MIN_BACKOFF_MS and carries up to 250ms of random jitter (full
 * jitter, avoids synchronized retry storms across concurrent requests) before
 * being capped.
 */
export function backoffMs(attempt: number, retryAfterHeader: string | null, bodyText: string): number {
  const jitter = () => Math.random() * 250;
  // 1. Retry-After header (seconds)
  const headerSecs = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  if (Number.isFinite(headerSecs) && headerSecs >= 0) {
    return Math.min(Math.max(headerSecs * 1000, MIN_BACKOFF_MS) + jitter(), MAX_BACKOFF_MS);
  }
  // 2. Provider message hint, e.g. "Please try again in 3.6s"
  const match = bodyText.match(/try again in ([\d.]+)\s*s/i);
  if (match) {
    return Math.min(Math.max(Number(match[1]) * 1000, MIN_BACKOFF_MS) + jitter(), MAX_BACKOFF_MS);
  }
  // 3. Exponential backoff: 1s, 2s ...
  return Math.min(Math.max(1000 * 2 ** attempt, MIN_BACKOFF_MS) + jitter(), MAX_BACKOFF_MS);
}

/**
 * Semantic provider role. Prod runs three SEPARATE endpoints (OpenAI for
 * generation, Cerebras for judging/small tasks, Groq as fallback) that cannot
 * be consolidated behind one base URL, so a role selects its own
 * {baseUrl, apiKey, model} triplet from env. Unset role env → falls back to the
 * global LLM_* primary, so local/CI (one provider) needs zero role config.
 *   generate → LLM_GENERATE_*  (main quality model, e.g. GPT-5.5)
 *   judge    → LLM_JUDGE_*     (scoring/evaluation, e.g. Cerebras)
 *   small    → LLM_SMALL_*     (humanize, targeted revise, edit passes)
 */
export type ProviderRole = 'generate' | 'judge' | 'small';

/** Options for a single chat completion. All optional. */
export interface ChatCompletionOptions {
  maxTokens?: number;
  temperature?: number;
  /** Override the env model for this call (rarely needed). */
  model?: string;
  /**
   * Route this call to a specific provider endpoint by role. When the role's
   * LLM_<ROLE>_* env triplet is set it owns baseUrl+key+model (options.model is
   * ignored). When unset, resolution falls through to the global LLM_* primary.
   */
  role?: ProviderRole;
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
  // HF is already primary - don't use it as its own fallback.
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
 * Per-role env triplets. A role selects its own endpoint so generate/judge/small
 * can point at three separate providers (OpenAI/Cerebras/Groq) that cannot share
 * one base URL.
 */
const ROLE_ENV: Record<ProviderRole, { url: string; key: string; model: string }> = {
  generate: { url: 'LLM_GENERATE_BASE_URL', key: 'LLM_GENERATE_API_KEY', model: 'LLM_GENERATE_MODEL' },
  judge: { url: 'LLM_JUDGE_BASE_URL', key: 'LLM_JUDGE_API_KEY', model: 'LLM_JUDGE_MODEL' },
  small: { url: 'LLM_SMALL_BASE_URL', key: 'LLM_SMALL_API_KEY', model: 'LLM_SMALL_MODEL' },
};

/**
 * Resolves a role to its dedicated provider, or null when the role's env triplet
 * is not fully set (so the caller falls back to the global LLM_* primary). All
 * three vars (url+key+model) must be present; a partial triplet is treated as
 * unconfigured rather than a half-built provider.
 */
function resolveRoleProvider(role: ProviderRole): Provider | null {
  const env = ROLE_ENV[role];
  const url = process.env[env.url]?.trim();
  const key = process.env[env.key]?.trim();
  const model = process.env[env.model]?.trim();
  if (url && key && model) {
    return { baseUrl: url.replace(/\/+$/, ''), apiKey: key, model, label: `role:${role}` };
  }
  return null;
}

/**
 * Selects the primary provider for a call: an explicit role endpoint when
 * configured, else the global LLM_* primary (which honors options.model). Shared
 * by chatCompletion and chatCompletionStream so both route roles identically.
 */
function resolvePrimary(options: ChatCompletionOptions): Provider | null {
  return (options.role ? resolveRoleProvider(options.role) : null) ?? getPrimaryProvider(options.model);
}

/**
 * Run one chat completion against a specific provider. `retryRateLimit` controls
 * whether a 429 is retried in place with backoff - we disable it when a fallback
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
  const maxTokens =
    options.maxTokens ??
    (isReasoningModel(provider.model) ? REASONING_DEFAULT_MAX_TOKENS : DEFAULT_MAX_TOKENS);
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
 * actually works" - presence checks stay green even when the key is empty/wrong,
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
  // Global spend backstop - runs before ANY provider (primary or HF fallback),
  // so every text-gen path in the app (generate, signals, leads, crons) is
  // bounded by one deployment-wide daily cap. Inert unless LLM_DAILY_HARD_CAP set.
  if ((await checkGlobalLlmBudget()) === 'blocked') {
    throw new LlmError('Global daily AI budget reached. Generation paused to protect credits.', 429);
  }

  const primary = resolvePrimary(options);
  if (!primary) {
    // No provider configured -> legacy HuggingFace SDK path (last resort).
    return generateContentHF(systemPrompt, userPrompt);
  }

  const fallback = getFallbackProvider(primary);
  try {
    // If a fallback exists, don't waste time retrying a rate-limited primary -
    // fail fast and switch. Without a fallback, keep the in-place retry loop.
    return await callProviderWithJsonFallback(primary, systemPrompt, userPrompt, options, !fallback);
  } catch (err) {
    // On quota/credit/rate-limit exhaustion, try the fallback provider.
    if (err instanceof LlmError && err.isQuota && fallback) {
      // Dynamic imports (not static top-of-file): llm.ts is used by many
      // non-pipeline callers (leads, signals, crons) that never pay the
      // Next-runtime import cost unless a fallback actually fires. This
      // event's request_id is synthetic (llm.ts has no pipeline request
      // context) - it still answers "how often does the primary provider
      // fail over" in aggregate, which is the observability spec 3.3 asks for.
      // Emit is best-effort observability - it must NEVER prevent the failover
      // itself. A throw from the dynamic imports (not just from the swallow-safe
      // emit) would otherwise leak a quota error past the fallback below.
      try {
        const { emitPipelineEvent } = await import('@/lib/content-pipeline/events');
        const { createRequestId } = await import('@/lib/logger');
        await emitPipelineEvent({
          requestId: createRequestId(),
          event: 'provider_retry',
          detail: { from: primary.label, to: fallback.label, reason: err.message },
        });
      } catch {
        // Observability must not block failover.
      }
      // Use the fallback's own model, not the primary's override.
      return callProviderWithJsonFallback(fallback, systemPrompt, userPrompt, { ...options, model: undefined }, true);
    }
    throw err;
  }
}

const DESCRIBE_IMAGE_PROMPT =
  'Describe this image in one or two plain sentences: setting, people count, what is ' +
  'happening, any visible text/signage. Concrete visual details only - never guess names ' +
  'or identities of people in the photo.';

/**
 * One-time vision description of an image URL, cached by the caller (imports
 * call this once per image and store the result - never re-run per generation).
 * Best-effort like every other optional enhancement in this codebase (Supermemory
 * writes, humanizer, evaluator): never throws, returns null on any failure
 * (no vision-capable model configured, provider rejects the request, network
 * error) so a bad/missing description degrades to "no image context" rather
 * than blocking the import.
 */
export async function describeImage(imageUrl: string, model?: string): Promise<string | null> {
  if ((await checkGlobalLlmBudget()) === 'blocked') return null;

  const visionModel = model ?? process.env.LLM_VISION_MODEL;
  const primary = getPrimaryProvider(visionModel);
  if (!primary || !visionModel) return null;

  try {
    const response = await fetch(`${primary.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${primary.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: primary.model,
        max_tokens: 150,
        temperature: 0.2,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: DESCRIBE_IMAGE_PROMPT },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
      }),
    });
    if (!response.ok) {
      console.warn('[describeImage] provider rejected request', response.status, await response.text().catch(() => ''));
      return null;
    }
    const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (err) {
    console.warn('[describeImage] failed (non-fatal)', err);
    return null;
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
  const maxTokens =
    options.maxTokens ??
    (isReasoningModel(provider.model) ? REASONING_DEFAULT_MAX_TOKENS : DEFAULT_MAX_TOKENS);
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
        // Ignore malformed/partial JSON - the next chunk completes it.
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
 * non-streamed completion and emits the whole result at once - so callers always
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

  const primary = resolvePrimary(options);
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
    // Only recover if nothing has streamed yet - otherwise we'd duplicate output.
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
