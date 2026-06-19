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

  it('honors an explicit direct mode', () => {
    vi.stubEnv('SOCIAL_PROVIDER_MODE', 'direct');
    expect(getSocialProviderMode()).toBe('direct');
  });

  it('uses ayrshare when an Ayrshare key is present', () => {
    vi.stubEnv('SOCIAL_PROVIDER_MODE', '');
    vi.stubEnv('AYRSHARE_API_KEY', 'key');
    expect(getSocialProviderMode()).toBe('ayrshare');
  });
});
