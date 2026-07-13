import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/insforge/server';
import {
  syncUnipileAccountsForUser,
  UnipileAccountsSyncError,
} from '@/lib/social/sync-unipile-accounts';

/**
 * POST /api/social-accounts/sync
 *
 * Binds the account the user just connected. Because the shared Unipile API key's
 * GET /accounts has no per-user filter, we diff against the pre-connect snapshot
 * (written by /connect/unipile) and bind only the newly-appeared account. No
 * snapshot → binds nothing (identity is never guessed from the shared list).
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
