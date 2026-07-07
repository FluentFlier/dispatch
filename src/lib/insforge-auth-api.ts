import { logWarn } from '@/lib/logger';
import { displayNameFromAuthUser } from '@/lib/user-display-name';

export interface InsforgeAuthUser {
  id?: string;
  email?: string;
  name?: string;
  user_metadata?: Record<string, unknown>;
  profile?: { name?: string } | null;
}

export interface InsforgeTokenPayload {
  accessToken: string;
  refreshToken?: string;
  user?: InsforgeAuthUser;
}

function insforgeBaseUrl(): string | null {
  const rawUrl = process.env.NEXT_PUBLIC_INSFORGE_URL;
  return rawUrl ? rawUrl.replace(/\/+$/, '') : null;
}

function decodeJwtPayload(token: string): {
  sub?: string;
  email?: string;
  user_metadata?: { email?: string; full_name?: string; name?: string };
  name?: string;
} | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '=='.slice(0, (4 - payload.length % 4) % 4);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf-8')) as ReturnType<typeof decodeJwtPayload>;
  } catch {
    return null;
  }
}

/** Normalize InsForge auth JSON (camelCase or snake_case fields). */
export function parseInsforgeTokenPayload(raw: unknown): InsforgeTokenPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const body = raw as Record<string, unknown>;
  const accessToken = body.accessToken ?? body.access_token;
  if (typeof accessToken !== 'string' || accessToken.length === 0) return null;

  const refreshRaw = body.refreshToken ?? body.refresh_token;
  const refreshToken = typeof refreshRaw === 'string' && refreshRaw.length > 0 ? refreshRaw : undefined;

  const userRaw = body.user;
  const user = userRaw && typeof userRaw === 'object' ? (userRaw as InsforgeAuthUser) : undefined;

  return { accessToken, refreshToken, user };
}

export function userFromAccessToken(accessToken: string): { id: string; email: string; name?: string } | null {
  const claims = decodeJwtPayload(accessToken);
  if (!claims?.sub) return null;
  const name =
    claims.user_metadata?.full_name?.trim() ||
    claims.user_metadata?.name?.trim() ||
    claims.name?.trim() ||
    undefined;
  return {
    id: claims.sub,
    email: claims.email ?? claims.user_metadata?.email ?? '',
    ...(name ? { name } : {}),
  };
}

export function resolveAuthUser(
  payload: InsforgeTokenPayload,
): { id: string; email: string; name?: string } | null {
  if (payload.user?.id) {
    const name =
      displayNameFromAuthUser(payload.user as Parameters<typeof displayNameFromAuthUser>[0]) ??
      payload.user.profile?.name?.trim() ??
      payload.user.name?.trim() ??
      undefined;
    return {
      id: payload.user.id,
      email: payload.user.email ?? '',
      ...(name ? { name } : {}),
    };
  }
  return userFromAccessToken(payload.accessToken);
}

async function postInsforgeAuth(
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: true; payload: InsforgeTokenPayload } | { ok: false; status: number; unauthorized: boolean }> {
  const baseUrl = insforgeBaseUrl();
  if (!baseUrl) return { ok: false, status: 0, unauthorized: false };

  let res: Response;
  try {
    res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
  } catch (err) {
    logWarn('auth.insforge_network_error', {
      path,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, status: 0, unauthorized: false };
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    const code = (errBody as { error?: string }).error;
    logWarn('auth.insforge_request_failed', {
      path,
      status: res.status,
      error: code,
      message: (errBody as { message?: string }).message,
    });
    return {
      ok: false,
      status: res.status,
      unauthorized: res.status === 401 || code === 'AUTH_UNAUTHORIZED',
    };
  }

  const parsed = parseInsforgeTokenPayload(await res.json());
  if (!parsed) return { ok: false, status: 0, unauthorized: false };
  return { ok: true, payload: parsed };
}

/** OAuth code exchange — server/mobile flow returns refreshToken in body. */
export async function exchangeOAuthCodeViaApi(
  code: string,
  codeVerifier: string,
): Promise<InsforgeTokenPayload | null> {
  const clientTypes = ['server', 'mobile'] as const;
  for (const clientType of clientTypes) {
    const exchanged = await postInsforgeAuth(`/api/auth/oauth/exchange?client_type=${clientType}`, {
      code,
      code_verifier: codeVerifier,
    });
    if (exchanged.ok && exchanged.payload.refreshToken) {
      return exchanged.payload;
    }
  }
  return null;
}

/** Refresh tokens — tries server then mobile; sends both body key styles. */
export type RefreshTokensResult =
  | { ok: true; payload: InsforgeTokenPayload }
  | { ok: false; unauthorized: boolean };

export async function refreshTokensViaApi(refreshToken: string): Promise<RefreshTokensResult> {
  const clientTypes = ['server', 'mobile'] as const;
  const bodies = [
    { refreshToken },
    { refresh_token: refreshToken },
  ] as const;

  let sawUnauthorized = false;

  for (const clientType of clientTypes) {
    for (const body of bodies) {
      const result = await postInsforgeAuth(`/api/auth/refresh?client_type=${clientType}`, body);
      if (result.ok) {
        return {
          ok: true,
          payload: {
            accessToken: result.payload.accessToken,
            refreshToken: result.payload.refreshToken ?? refreshToken,
            user: result.payload.user,
          },
        };
      }
      if (result.unauthorized) {
        sawUnauthorized = true;
      }
    }
  }

  return { ok: false, unauthorized: sawUnauthorized };
}
