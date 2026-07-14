import { isTinyFishConfigured } from '@/lib/signals/ingest/tinyfish-fetch';

/** Env-only LLM check - safe for client bundles (no @/lib/llm import). */
export function isLlmConfiguredForDiscovery(): boolean {
  const hfKey = process.env.HUGGINGFACE_API_KEY?.trim();
  const url = process.env.LLM_BASE_URL?.trim();
  const model = process.env.LLM_MODEL?.trim();
  const key = process.env.LLM_API_KEY?.trim() || hfKey;
  if (url && model && key) return true;
  return Boolean(hfKey);
}

export function isSerperWebDiscoveryConfigured(): boolean {
  return Boolean(process.env.SERPER_API_KEY?.trim()) && isLlmConfiguredForDiscovery();
}

export function isWebDiscoveryConfigured(): boolean {
  if (!isLlmConfiguredForDiscovery()) return false;
  return Boolean(process.env.SERPER_API_KEY?.trim()) || isTinyFishConfigured();
}
