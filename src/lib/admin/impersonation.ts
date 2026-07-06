import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { getServiceClient } from '@/lib/insforge/server';
import { isAdminEmail } from '@/lib/admin';

const COOKIE_NAME = 'content-os-impersonate';
const MAX_AGE_SEC = 60 * 60 * 4; // 4 hours

export interface ImpersonationPayload {
  adminId: string;
  adminEmail: string;
  targetUserId: string;
  exp: number;
}

export interface ImpersonationContext {
  adminId: string;
  adminEmail: string;
  targetUserId: string;
  targetDisplayName: string;
}

export interface SessionUser {
  id: string;
  email: string;
  name?: string;
}

export type EffectiveUser = SessionUser & {
  impersonation?: ImpersonationContext;
};

function signingKey(): string | null {
  return process.env.TOKEN_ENCRYPTION_KEY?.trim() || process.env.CRON_SECRET?.trim() || null;
}

/**
 * Signs impersonation payload with HMAC so only the server can mint valid cookies.
 */
function signPayload(payload: ImpersonationPayload): string | null {
  const key = signingKey();
  if (!key) return null;
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', key).update(body).digest('base64url');
  return `${body}.${sig}`;
}

/**
 * Verifies and decodes the impersonation cookie value.
 */
export function verifyImpersonationToken(token: string): ImpersonationPayload | null {
  const key = signingKey();
  if (!key) return null;

  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac('sha256', key).update(body).digest('base64url');

  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf-8')) as ImpersonationPayload;
    if (!payload.adminId || !payload.adminEmail || !payload.targetUserId || !payload.exp) return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * Sets the httpOnly impersonation cookie after admin starts a support session.
 */
export function setImpersonationCookie(admin: SessionUser, targetUserId: string): boolean {
  const token = signPayload({
    adminId: admin.id,
    adminEmail: admin.email,
    targetUserId,
    exp: Math.floor(Date.now() / 1000) + MAX_AGE_SEC,
  });
  if (!token) return false;

  const store = cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SEC,
  });
  return true;
}

/**
 * Clears the impersonation cookie when admin ends support session.
 */
export function clearImpersonationCookie(): void {
  const store = cookies();
  store.set(COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

/**
 * Reads impersonation payload from cookie without validating admin session.
 */
export function readImpersonationPayload(): ImpersonationPayload | null {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) return null;
  return verifyImpersonationToken(token);
}

/**
 * When a valid impersonation cookie exists and the real session is the same admin,
 * returns the target user's identity for app routes; otherwise returns session user.
 */
export async function applyImpersonation(sessionUser: SessionUser): Promise<EffectiveUser> {
  const payload = readImpersonationPayload();
  if (!payload) return sessionUser;

  if (payload.adminId !== sessionUser.id || !isAdminEmail(sessionUser.email)) {
    return sessionUser;
  }

  const client = getServiceClient();
  const { data: profile } = await client.database
    .from('creator_profile')
    .select('display_name')
    .eq('user_id', payload.targetUserId)
    .maybeSingle();

  const displayName = (profile?.display_name as string | undefined) ?? 'User';

  return {
    id: payload.targetUserId,
    email: `${payload.targetUserId}@impersonated.local`,
    name: displayName,
    impersonation: {
      adminId: payload.adminId,
      adminEmail: payload.adminEmail,
      targetUserId: payload.targetUserId,
      targetDisplayName: displayName,
    },
  };
}

/**
 * Returns banner context when admin is actively impersonating.
 */
export async function getImpersonationContext(
  sessionUser: SessionUser | null,
): Promise<ImpersonationContext | null> {
  if (!sessionUser) return null;
  const effective = await applyImpersonation(sessionUser);
  return effective.impersonation ?? null;
}
