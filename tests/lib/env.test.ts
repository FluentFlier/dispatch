import { describe, it, expect, afterEach, vi } from 'vitest';
import { assertProductionEnv, getSocialProviderMode } from '@/lib/env';

describe('assertProductionEnv', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is a no-op outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(() => assertProductionEnv()).not.toThrow();
  });

  it('throws in production when required keys are missing', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('INSFORGE_SERVICE_ROLE_KEY', '');
    vi.stubEnv('CRON_SECRET', '');
    expect(() => assertProductionEnv()).toThrow(/Missing required production env/);
  });

  it('requires a 64-char TOKEN_ENCRYPTION_KEY in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_INSFORGE_URL', 'https://x');
    vi.stubEnv('NEXT_PUBLIC_INSFORGE_ANON_KEY', 'anon');
    vi.stubEnv('INSFORGE_SERVICE_ROLE_KEY', 'service');
    vi.stubEnv('CRON_SECRET', 'cron');
    vi.stubEnv('TOKEN_ENCRYPTION_KEY', 'too-short');
    expect(() => assertProductionEnv()).toThrow(/TOKEN_ENCRYPTION_KEY/);
  });
});

describe('getSocialProviderMode', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('honors an explicit direct mode when Unipile is not configured', () => {
    vi.stubEnv('SOCIAL_PROVIDER_MODE', 'direct');
    vi.stubEnv('UNIPILE_API_KEY', '');
    vi.stubEnv('UNIPILE_DSN', '');
    expect(getSocialProviderMode()).toBe('direct');
  });

  it('uses unipile when UNIPILE_API_KEY + DSN are present', () => {
    vi.stubEnv('SOCIAL_PROVIDER_MODE', '');
    vi.stubEnv('UNIPILE_API_KEY', 'key');
    vi.stubEnv('UNIPILE_DSN', 'dsn.unipile.com');
    expect(getSocialProviderMode()).toBe('unipile');
  });

  it('prefers unipile over a stale SOCIAL_PROVIDER_MODE=direct when keys exist', () => {
    // Regression: connect flow opens Unipile whenever keys exist, so the
    // resolver must not report direct and leave the UI on a dead LinkedIn OAuth.
    vi.stubEnv('SOCIAL_PROVIDER_MODE', 'direct');
    vi.stubEnv('UNIPILE_API_KEY', 'key');
    vi.stubEnv('UNIPILE_DSN', 'dsn.unipile.com');
    expect(getSocialProviderMode()).toBe('unipile');
  });

  it('defaults to unipile when nothing is configured (Unipile is the supported provider)', () => {
    vi.stubEnv('SOCIAL_PROVIDER_MODE', '');
    vi.stubEnv('UNIPILE_API_KEY', '');
    vi.stubEnv('UNIPILE_DSN', '');
    expect(getSocialProviderMode()).toBe('unipile');
  });
});
