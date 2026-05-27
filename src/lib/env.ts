/**
 * Runtime environment validation. Call assertProductionEnv() at startup-sensitive paths.
 */

const REQUIRED_PROD = [
  'NEXT_PUBLIC_INSFORGE_URL',
  'NEXT_PUBLIC_INSFORGE_ANON_KEY',
  'TOKEN_ENCRYPTION_KEY',
  'CRON_SECRET',
] as const;

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function getSocialProviderMode(): 'ayrshare' | 'direct' {
  const mode = process.env.SOCIAL_PROVIDER_MODE?.toLowerCase();
  if (mode === 'direct') return 'direct';
  if (process.env.AYRSHARE_API_KEY) return 'ayrshare';
  return mode === 'ayrshare' ? 'ayrshare' : 'direct';
}

export function assertProductionEnv(): void {
  if (!isProduction()) return;

  const missing = REQUIRED_PROD.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required production env: ${missing.join(', ')}`);
  }

  const key = process.env.TOKEN_ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    throw new Error('TOKEN_ENCRYPTION_KEY must be 64 hex chars (32 bytes) in production');
  }
}

export function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
}
