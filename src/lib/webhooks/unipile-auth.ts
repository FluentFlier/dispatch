import { timingSafeEqual } from 'crypto';
import { isProduction } from '@/lib/env';

/**
 * Constant-time comparison for Unipile's echoed Unipile-Auth header.
 * Unipile does not HMAC-sign payloads; we attach a shared secret when creating
 * the webhook and reject deliveries that do not match.
 */
export function isValidUnipileAuth(headerValue: string | null, secret: string): boolean {
  if (!headerValue) return false;
  const provided = Buffer.from(headerValue);
  const expected = Buffer.from(secret);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

export type UnipileWebhookAuthResult =
  | { ok: true }
  | { ok: false; status: 401 | 503; error: string };

/**
 * Validates an incoming Unipile webhook request.
 * Production always requires UNIPILE_WEBHOOK_SECRET — no bypass.
 * Development allows missing secret for local testing only.
 */
export function validateUnipileWebhookAuth(
  secret: string | undefined,
  authHeader: string | null,
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
      '[webhooks/unipile] UNIPILE_WEBHOOK_SECRET not configured. Bypassing auth check for local development only.',
    );
    return { ok: true };
  }

  if (!isValidUnipileAuth(authHeader, secret)) {
    return { ok: false, status: 401, error: 'Invalid webhook auth' };
  }

  return { ok: true };
}
