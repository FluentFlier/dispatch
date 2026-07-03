/**
 * Runtime environment validation. Call assertProductionEnv() at startup-sensitive paths.
 */

const REQUIRED_PROD = [
  'NEXT_PUBLIC_INSFORGE_URL',
  'NEXT_PUBLIC_INSFORGE_ANON_KEY',
  'INSFORGE_SERVICE_ROLE_KEY',
  'TOKEN_ENCRYPTION_KEY',
  'CRON_SECRET',
] as const;

export function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function getSocialProviderMode(): 'unipile' | 'direct' {
  const mode = process.env.SOCIAL_PROVIDER_MODE?.toLowerCase();
  if (mode === 'direct') return 'direct';
  if (process.env.UNIPILE_API_KEY) return 'unipile';
  return mode === 'unipile' ? 'unipile' : 'direct';
}

export function assertProductionEnv(): void {
  if (!isProduction()) return;

  const missing: string[] = REQUIRED_PROD.filter((key) => !process.env[key]?.trim());
  if (getSocialProviderMode() === 'unipile' && !process.env.UNIPILE_WEBHOOK_SECRET?.trim()) {
    missing.push('UNIPILE_WEBHOOK_SECRET');
  }
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
