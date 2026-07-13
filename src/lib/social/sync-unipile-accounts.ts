import { getServerClient, getServiceClient } from '@/lib/insforge/server';
import { unipoleFetch } from '@/lib/social/unipile';
import {
  backfillNullWorkspaceSocialAccounts,
  ensureActiveWorkspaceId,
} from '@/lib/workspace';

interface UnipileAccount {
  id: string;
  // API list response uses 'type'; webhook payload uses 'provider'.
  type?: string;
  provider?: string;
  username?: string;
  name?: string;
  connection_status?: string;
  connection_params?: {
    im?: { username?: string; publicIdentifier?: string };
  };
}

export class UnipileAccountsSyncError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'UnipileAccountsSyncError';
  }
}

export interface UnipileAccountsSyncResult {
  synced: number;
  workspaceId: string;
  message?: string;
}

function mapUnipilePlatform(account: UnipileAccount) {
  const providerRaw = (account.type ?? account.provider ?? '').toLowerCase();
  if (providerRaw === 'linkedin') return 'linkedin';
  if (providerRaw === 'twitter' || providerRaw === 'x' || providerRaw === 'twitter_v2') return 'twitter';
  if (providerRaw === 'instagram') return 'instagram';
  if (providerRaw === 'threads') return 'threads';
  return null;
}

/**
 * Picks the accounts safe to bind to the connecting user. An account qualifies
 * only if it appeared AFTER the pre-connect snapshot, isn't owned by another
 * user, and is the ONLY new account of its platform. Two concurrent connects
 * produce >1 new account of a platform → ambiguous → bound to nobody here
 * (the state-bound webhook resolves those). This is the guard against the old
 * "grab the first id Unipile returns" cross-wiring bug — keep it pure + tested.
 */
export function pickAccountsToBind(
  accounts: UnipileAccount[],
  snapshotIds: Set<string>,
  claimedByOthers: Set<string>,
): UnipileAccount[] {
  const seen = new Set<string>();
  const byPlatform = new Map<string, UnipileAccount[]>();
  for (const account of accounts) {
    if (seen.has(account.id)) continue;
    seen.add(account.id);
    if (snapshotIds.has(account.id) || claimedByOthers.has(account.id)) continue;
    const platform = mapUnipilePlatform(account);
    if (!platform) continue;
    const group = byPlatform.get(platform) ?? [];
    group.push(account);
    byPlatform.set(platform, group);
  }
  return Array.from(byPlatform.values())
    .filter((group) => group.length === 1)
    .map((group) => group[0]);
}

export async function syncUnipileAccountsForUser(
  userId: string,
): Promise<UnipileAccountsSyncResult> {
  if (!process.env.UNIPILE_API_KEY || !process.env.UNIPILE_DSN) {
    throw new UnipileAccountsSyncError('Unipile not configured', 503);
  }

  const res = await unipoleFetch('/accounts', { method: 'GET' });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('[sync/unipile] GET /accounts failed:', res.status, body.slice(0, 200));
    throw new UnipileAccountsSyncError(`Unipile accounts fetch failed (${res.status})`, 502);
  }

  const rawData = await res.json() as Record<string, unknown>;
  const accounts: UnipileAccount[] = (
    (rawData.items as UnipileAccount[] | undefined) ??
    (rawData.accounts as UnipileAccount[] | undefined) ??
    (rawData.data as UnipileAccount[] | undefined) ??
    []
  );

  const client = getServerClient();
  const workspaceId = await ensureActiveWorkspaceId(userId);
  await backfillNullWorkspaceSocialAccounts(userId, workspaceId);

  if (accounts.length === 0) {
    return { synced: 0, workspaceId, message: 'No accounts found in Unipile' };
  }

  const serviceClient = getServiceClient();

  // Pre-connect snapshot written by /connect/unipile. Its absence means this
  // call is NOT a fresh connect (e.g. a settings-page load) — bind nothing, so
  // we never re-derive identity from the shared list (the old cross-wiring bug).
  const { data: snapRow } = await serviceClient.database
    .from('unipile_connect_snapshots')
    .select('account_ids')
    .eq('user_id', userId)
    .maybeSingle();

  if (!snapRow) {
    return { synced: 0, workspaceId, message: 'No pending connect — nothing to bind' };
  }
  const snapshotIds = new Set(
    ((snapRow as { account_ids?: string[] }).account_ids ?? []).filter(Boolean),
  );

  const { data: allClaimed } = await serviceClient.database
    .from('social_accounts')
    .select('unipile_account_id, user_id')
    .not('unipile_account_id', 'is', null)
    .neq('user_id', userId);

  const claimedByOthers = new Set(
    (allClaimed ?? [])
      .map((r) => (r as { unipile_account_id: string }).unipile_account_id)
      .filter(Boolean),
  );

  const clearSnapshot = () =>
    serviceClient.database.from('unipile_connect_snapshots').delete().eq('user_id', userId);

  const toBind = pickAccountsToBind(accounts, snapshotIds, claimedByOthers);

  let synced = 0;
  for (const account of toBind) {
    const platform = mapUnipilePlatform(account)!;
    const accountName = account.name ?? account.connection_params?.im?.username ?? null;
    const accountId = account.connection_params?.im?.publicIdentifier ?? account.username ?? null;

    const { data: existing } = await client.database
      .from('social_accounts')
      .select('id')
      .eq('user_id', userId)
      .eq('platform', platform)
      .maybeSingle();

    if (existing) {
      await client.database
        .from('social_accounts')
        .update({
          unipile_account_id: account.id,
          account_name: accountName,
          account_id: accountId,
          connection_method: 'unipile',
          connected_at: new Date().toISOString(),
        })
        .eq('id', (existing as { id: string }).id);
    } else {
      await client.database
        .from('social_accounts')
        .insert({
          user_id: userId,
          workspace_id: workspaceId,
          platform,
          unipile_account_id: account.id,
          account_name: accountName,
          account_id: accountId,
          access_token: '',
          connection_method: 'unipile',
          connected_at: new Date().toISOString(),
        });
    }
    synced++;
  }

  await clearSnapshot();
  return { synced, workspaceId };
}
