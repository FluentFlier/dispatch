import { createHmac, timingSafeEqual } from 'crypto';
import { isProduction } from '@/lib/env';

/**
 * Constant-time comparison for hosted callback query tokens.
 */
export function isValidUnipileAuth(headerValue: string | null, secret: string): boolean {
  if (!headerValue) return false;
  const provided = Buffer.from(headerValue);
  const expected = Buffer.from(secret);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

export function isValidUnipileSignature(
  signatureHeader: string | null,
  secret: string,
  rawBody: string,
  nowMs = Date.now(),
  toleranceSeconds = 300,
): boolean {
  if (!signatureHeader) return false;

  const parts = Object.fromEntries(
    signatureHeader.split(',').map((part) => {
      const [key, value] = part.split('=');
      return [key, value];
    }),
  );
  const timestamp = parts.t;
  const receivedSignature = parts.v0;
  if (!timestamp || !receivedSignature) return false;

  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds)) return false;
  const ageSeconds = Math.abs(Math.floor(nowMs / 1000) - timestampSeconds);
  if (ageSeconds > toleranceSeconds) return false;

  const expectedSignature = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');

  const provided = Buffer.from(receivedSignature);
  const expected = Buffer.from(expectedSignature);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

export type UnipileWebhookAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string };

/**
 * Validates an incoming API-managed Unipile webhook request.
 * Production requires UNIPILE_WEBHOOK_SECRET and the documented
 * unipile-signature HMAC header. Development allows unsigned local testing.
 */
export function validateUnipileWebhookAuth(
  secret: string | undefined,
  signatureHeader: string | null,
  rawBody = '',
  production = isProduction(),
): UnipileWebhookAuthResult {
  if (!secret?.trim()) {
    if (production) {
      return {
        ok: false,
        status: 503,
        error: 'UNIPILE_WEBHOOK_SECRET is required in production',
      };
    }
    console.warn(
      '[webhooks/unipile] UNIPILE_WEBHOOK_SECRET not configured. Bypassing signature check for local development only.',
    );
    return { ok: true };
  }

  if (!isValidUnipileSignature(signatureHeader, secret, rawBody)) {
    return { ok: false, status: 401, error: 'Invalid webhook signature' };
  }

  return { ok: true };
}
