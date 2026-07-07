import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/insforge/server';
import {
  syncUnipileAccountsForUser,
  UnipileAccountsSyncError,
} from '@/lib/social/sync-unipile-accounts';

/**
 * POST /api/social-accounts/sync
 *
 * Polls Unipile GET /accounts, then stores connected accounts for the current user.
 *
 * Security: Unipile's GET /accounts returns all accounts for the shared API key.
 * The shared sync helper skips any account already claimed by a different user.
 */
export async function POST(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const result = await syncUnipileAccountsForUser(user.id);
    return NextResponse.json(
      result.message ? { synced: result.synced, message: result.message } : { synced: result.synced },
    );
  } catch (err: unknown) {
    if (err instanceof UnipileAccountsSyncError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error('[sync/unipile] Unexpected sync failure:', err);
    return NextResponse.json({ error: 'Failed to sync social accounts' }, { status: 500 });
  }
}
