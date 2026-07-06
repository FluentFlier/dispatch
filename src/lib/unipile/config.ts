/** Strip scheme/trailing slash so DSN works whether stored as host:port or full URL. */
export function normalizeUnipileDsn(dsn: string): string {
  return dsn.trim().replace(/^https?:\/\//i, '').replace(/\/$/, '');
}

export function getUnipileApiKey(): string | null {
  const key = process.env.UNIPILE_API_KEY?.trim();
  return key || null;
}

export function getUnipileApiBase(): string | null {
  const dsn = process.env.UNIPILE_DSN?.trim();
  if (!dsn) return null;
  return `https://${normalizeUnipileDsn(dsn)}/api/v1`;
}

export function getUnipileServerUrl(): string | null {
  const dsn = process.env.UNIPILE_DSN?.trim();
  if (!dsn) return null;
  return `https://${normalizeUnipileDsn(dsn)}`;
}

export function isUnipileConfigured(): boolean {
  return Boolean(getUnipileApiKey() && getUnipileApiBase());
}

/**
 * Lightweight live probe — validates API key against Unipile /accounts.
 */
export async function pingUnipileApi(): Promise<'ok' | 'error' | 'skipped'> {
  const apiBase = getUnipileApiBase();
  const apiKey = getUnipileApiKey();
  if (!apiBase || !apiKey) return 'skipped';

  try {
    const res = await fetch(`${apiBase}/accounts?limit=1`, {
      headers: { 'X-API-KEY': apiKey, accept: 'application/json' },
      cache: 'no-store',
    });
    return res.ok ? 'ok' : 'error';
  } catch {
    return 'error';
  }
}
