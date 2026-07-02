/**
 * Task-tier → concrete-model resolver — the layer that lets us build for the
 * best models while swapping free models (Groq, HuggingFace) in and out via env.
 *
 * WHY: production targets premium models, but testing runs on free tiers because
 * there is no funding yet. Hardcoding a provider-specific model id at a call site
 * (e.g. "claude-haiku-4-5") would 404/401 in testing against an endpoint that
 * does not exist there. Instead every call site declares a semantic TIER, and
 * this layer maps the tier to a concrete model id via env.
 *
 * Resolution:
 *   'fast'  -> $LLM_MODEL_FAST   (cheap/low-latency; e.g. claude-haiku-4-5 in prod)
 *   'smart' -> $LLM_MODEL_SMART  (highest quality; e.g. claude-opus-4-8 in prod)
 *
 * When a tier's env var is unset — the default in local/CI testing — this returns
 * `undefined`, so `chatCompletion` falls back to the globally configured
 * `LLM_MODEL` (Groq/HF). Net effect: testing needs ZERO tier config and just uses
 * the free model; production lights up premium models by setting two env vars.
 * Model choice is always an env change, never a code change.
 *
 * CONSTRAINT: a tier's model id must be valid on the configured `LLM_BASE_URL`
 * provider (one OpenAI-compatible gateway that routes by model name — OpenRouter,
 * the InsForge AI gateway, etc.). Do NOT point a tier at a Claude id while
 * `LLM_BASE_URL` is Groq — that model name will 400 on Groq. Keep tier ids and
 * the base URL provider in sync per environment.
 */

/** Semantic model tiers. Add new tiers here as call sites need them. */
export type ModelTier = 'fast' | 'smart';

const TIER_ENV: Record<ModelTier, string> = {
  fast: 'LLM_MODEL_FAST',
  smart: 'LLM_MODEL_SMART',
};

/**
 * Resolves a semantic tier to a concrete model id from env.
 * Returns undefined when unconfigured so the caller uses the global default model
 * (the free testing model). Pass the result straight to generateContent's
 * modelOverride / chatCompletion's options.model.
 */
export function resolveModel(tier: ModelTier): string | undefined {
  const value = process.env[TIER_ENV[tier]];
  return value && value.trim() ? value.trim() : undefined;
}
