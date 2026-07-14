// Env-only check from the client-safe module: this file is imported (via
// directory-defaults) by client UI, and tinyfish-fetch pulls in @/lib/llm →
// next/headers, which webpack must not bundle client-side.
import { isTinyfishConfigured as isTinyFishConfigured } from '@/lib/signals/ingest/tinyfish-web';

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
