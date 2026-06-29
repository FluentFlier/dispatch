import { createHmac, timingSafeEqual } from 'crypto';
import type { ComposioToolkit } from '@/lib/composio/config';

export interface ComposioOAuthState {
  workspaceId: string;
  userId: string;
  toolkit: ComposioToolkit;
}

function signingSecret(): string | null {
  return (
    process.env.COMPOSIO_STATE_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    process.env.TOKEN_ENCRYPTION_KEY?.trim() ||
    null
  );
}

function signPayload(payloadB64: string, secret: string): string {
  return createHmac('sha256', secret).update(payloadB64).digest('base64url');
}

export function encodeComposioState(state: ComposioOAuthState): string {
  const secret = signingSecret();
  if (!secret) {
    throw new Error('Missing COMPOSIO_STATE_SECRET, CRON_SECRET, or TOKEN_ENCRYPTION_KEY');
  }
  const payloadB64 = Buffer.from(JSON.stringify(state)).toString('base64url');
  const sig = signPayload(payloadB64, secret);
  return `${payloadB64}.${sig}`;
}

export function decodeComposioState(raw: string | null): ComposioOAuthState | null {
  if (!raw) return null;
  const secret = signingSecret();
  if (!secret) return null;

  const [payloadB64, sig] = raw.split('.');
  if (!payloadB64 || !sig) return null;

  const expected = signPayload(payloadB64, secret);
  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  try {
    const json = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (!json.workspaceId || !json.userId || !json.toolkit) return null;
    return json as ComposioOAuthState;
  } catch {
    return null;
  }
}
