import { AsyncLocalStorage } from 'node:async_hooks';

export interface WriteModelOption { id: string; label: string }
export interface WriteModelConfig extends WriteModelOption {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

const selection = new AsyncLocalStorage<WriteModelConfig>();

/**
 * Server-owned Write model catalog. The optional JSON env is an array of
 * {id,label,baseUrl,apiKeyEnv,model}. apiKeyEnv names an environment variable;
 * its value and provider URLs are never returned to the browser.
 */
export function getWriteModelCatalog(): WriteModelConfig[] {
  const primary: WriteModelConfig = { id: 'default', label: 'Default' };
  const raw = process.env.WRITE_MODEL_CATALOG_JSON?.trim();
  if (!raw) return [primary];
  try {
    const entries = JSON.parse(raw) as unknown;
    if (!Array.isArray(entries)) return [primary];
    const configured = entries.flatMap((entry): WriteModelConfig[] => {
      if (!entry || typeof entry !== 'object') return [];
      const value = entry as Record<string, unknown>;
      const id = typeof value.id === 'string' ? value.id.trim() : '';
      const label = typeof value.label === 'string' ? value.label.trim() : '';
      const baseUrl = typeof value.baseUrl === 'string' ? value.baseUrl.trim().replace(/\/+$/, '') : '';
      const apiKeyEnv = typeof value.apiKeyEnv === 'string' ? value.apiKeyEnv.trim() : '';
      const model = typeof value.model === 'string' ? value.model.trim() : '';
      const apiKey = apiKeyEnv ? process.env[apiKeyEnv]?.trim() : '';
      if (!id || !label || !baseUrl || !apiKey || !model || id === 'default') return [];
      return [{ id, label, baseUrl, apiKey, model }];
    });
    return [primary, ...configured];
  } catch {
    console.warn('[write-models] Invalid WRITE_MODEL_CATALOG_JSON; using default model only.');
    return [primary];
  }
}

export function resolveWriteModel(id?: string | null): WriteModelConfig | null {
  if (!id || id === 'default') return getWriteModelCatalog()[0];
  return getWriteModelCatalog().find((item) => item.id === id) ?? null;
}

export function withWriteModel<T>(model: WriteModelConfig, fn: () => Promise<T>): Promise<T> {
  return selection.run(model, fn);
}

export function getSelectedWriteModel(): WriteModelConfig | undefined {
  return selection.getStore();
}
