/**
 * Unipile webhook auth — production must fail closed when secret is missing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateUnipileWebhookAuth, isValidUnipileAuth } from '@/lib/webhooks/unipile-auth';

describe('Unipile webhook auth', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects production requests when UNIPILE_WEBHOOK_SECRET is missing', () => {
    const result = validateUnipileWebhookAuth(undefined, null, true);
    expect(result).toEqual({
      ok: false,
      status: 503,
      error: 'UNIPILE_WEBHOOK_SECRET is required in production',
    });
  });

  it('allows development requests when secret is missing', () => {
    const result = validateUnipileWebhookAuth(undefined, null, false);
    expect(result).toEqual({ ok: true });
  });

  it('rejects wrong auth header when secret is configured', () => {
    const secret = 'test-webhook-secret-value';
    const result = validateUnipileWebhookAuth(secret, 'wrong-header', true);
    expect(result).toEqual({ ok: false, status: 401, error: 'Invalid webhook auth' });
  });

  it('accepts matching auth header in production', () => {
    const secret = 'my-shared-unipile-secret';
    expect(isValidUnipileAuth(secret, secret)).toBe(true);
    const result = validateUnipileWebhookAuth(secret, secret, true);
    expect(result).toEqual({ ok: true });
  });
});
