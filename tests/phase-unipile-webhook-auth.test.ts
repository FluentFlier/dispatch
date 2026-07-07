/**
 * Unipile webhook auth: API-managed webhooks use unipile-signature HMAC.
 */
import { createHmac } from 'crypto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isValidUnipileAuth,
  isValidUnipileSignature,
  validateUnipileWebhookAuth,
} from '@/lib/webhooks/unipile-auth';

function sign(secret: string, rawBody: string, timestamp: number) {
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  return `t=${timestamp},v0=${signature}`;
}

describe('Unipile webhook auth', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects production API-managed webhooks when UNIPILE_WEBHOOK_SECRET is missing', () => {
    const result = validateUnipileWebhookAuth(undefined, null, '{}', true);
    expect(result).toEqual({
      ok: false,
      status: 503,
      error: 'UNIPILE_WEBHOOK_SECRET is required in production',
    });
  });

  it('allows development requests when signature secret is missing', () => {
    const result = validateUnipileWebhookAuth(undefined, null, '{}', false);
    expect(result).toEqual({ ok: true });
  });

  it('rejects a bad Unipile signature', () => {
    const result = validateUnipileWebhookAuth('secret', 't=123,v0=bad', '{"ok":true}', true);
    expect(result).toEqual({ ok: false, status: 401, error: 'Invalid webhook signature' });
  });

  it('accepts a valid Unipile signature over the raw body', () => {
    const secret = 'webhook-endpoint-secret';
    const rawBody = '{"status":"ok"}';
    const timestamp = Math.floor(Date.now() / 1000);
    const header = sign(secret, rawBody, timestamp);

    expect(isValidUnipileSignature(header, secret, rawBody, timestamp * 1000)).toBe(true);
    expect(validateUnipileWebhookAuth(secret, header, rawBody, true)).toEqual({ ok: true });
  });

  it('rejects expired signatures', () => {
    const secret = 'webhook-endpoint-secret';
    const rawBody = '{"status":"ok"}';
    const timestamp = 1_710_662_400;
    const header = sign(secret, rawBody, timestamp);

    expect(isValidUnipileSignature(header, secret, rawBody, (timestamp + 301) * 1000)).toBe(false);
  });

  it('validates hosted callback query tokens with constant-time compare', () => {
    expect(isValidUnipileAuth('callback-secret', 'callback-secret')).toBe(true);
    expect(isValidUnipileAuth('wrong', 'callback-secret')).toBe(false);
  });
});
