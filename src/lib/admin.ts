import { getSessionUser } from '@/lib/insforge/server';

/** HTTP error with status code for API route handlers. */
export class AdminError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AdminError';
  }
}

/**
 * Parses ADMIN_EMAILS into a normalized allowlist.
 * Empty list means no one has admin access (fail closed).
 */
export function getAdminEmails(): string[] {
  const raw = process.env.ADMIN_EMAILS ?? '';
  return raw
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Returns true when the email is in the ADMIN_EMAILS allowlist.
 */
export function isAdminEmail(email: string): boolean {
  const admins = getAdminEmails();
  if (admins.length === 0) return false;
  return admins.includes(email.trim().toLowerCase());
}

/**
 * Requires an authenticated session whose email is on ADMIN_EMAILS.
 * Use at the top of admin pages and /api/admin/* routes.
 */
export async function assertAdmin(): Promise<{ id: string; email: string }> {
  const user = await getSessionUser();
  if (!user) {
    throw new AdminError('Unauthenticated', 401);
  }
  if (!isAdminEmail(user.email)) {
    throw new AdminError('Forbidden — not an admin', 403);
  }
  return user;
}

/**
 * Maps AdminError to a NextResponse status; rethrows unknown errors.
 */
export function adminErrorResponse(err: unknown): { status: number; message: string } {
  if (err instanceof AdminError) {
    return { status: err.status, message: err.message };
  }
  const message = err instanceof Error ? err.message : 'Internal server error';
  return { status: 500, message };
}
