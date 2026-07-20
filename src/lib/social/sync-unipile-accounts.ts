import { getServerClient, getServiceClient } from '@/lib/insforge/server';
import { unipoleFetch, pruneDuplicateUnipileAccounts } from '@/lib/social/unipile';
import { isSnapshotExpired } from '@/lib/social/connect-snapshot';
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
    im?: { username?: string; publicIdentifier?: string; memberId?: string; id?: string };
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

function normalizedIdentity(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^@/, '').replace(/\/+$/, '').toLowerCase();
}

function accountClaimTokens(account: UnipileAccount): string[] {
  const im = account.connection_params?.im;
  return [
    account.id,
    account.username,
    im?.publicIdentifier,
    im?.memberId,
    im?.id,
  ]
    .map(normalizedIdentity)
    .filter(Boolean) as string[];
}

/**
 * Picks the accounts safe to bind to the connecting user. An account qualifies
 * only if it appeared AFTER the pre-connect snapshot, isn't owned by another
 * user, and is the ONLY new account of its platform. Two concurrent connects
 * produce >1 new account of a platform → ambiguous → bound to nobody here
 * (the state-bound webhook resolves those). This is the guard against the old
 * "grab the first id Unipile returns" cross-wiring bug - keep it pure + tested.
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
    if (snapshotIds.has(account.id) || accountClaimTokens(account).some((token) => claimedByOthers.has(token))) {
      continue;
    }
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

/**
 * Waits for the notify_url webhook to bind the account from THIS user's hosted
 * session. The webhook deletes the pre-connect snapshot once it has written the
 * row, so a vanished snapshot is our signal that the ground-truth bind landed.
 * Bounded poll - never blocks the connect flow indefinitely.
 */
async function waitForWebhookBind(
  serviceClient: ReturnType<typeof getServiceClient>,
  userId: string,
): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const { data: snap } = await serviceClient.database
      .from('unipile_connect_snapshots')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (!snap) return; // webhook consumed the snapshot → bind is done
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

export async function syncUnipileAccountsForUser(
  userId: string,
): Promise<UnipileAccountsSyncResult> {
  if (!process.env.UNIPILE_API_KEY || !process.env.UNIPILE_DSN) {
    throw new UnipileAccountsSyncError('Unipile not configured', 503);
  }

  const client = getServerClient();
  const workspaceId = await ensureActiveWorkspaceId(userId);
  await backfillNullWorkspaceSocialAccounts(userId, workspaceId);
  const serviceClient = getServiceClient();

  // Shared Unipile subscription: GET /accounts returns EVERY tenant user's
  // LinkedIn, with no per-user signal. Deriving "which one is mine" from that
  // list races concurrent connects and cross-wires strangers' accounts (users
  // saw a random name that kept changing). In any deployed environment the
  // notify_url webhook is reachable and binds the EXACT account from this user's
  // hosted session (state=user.id) - that is the only trustworthy source, so we
  // defer to it entirely here and never guess from the shared list.
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? '').toLowerCase();
  const isLocalhost = !appUrl || appUrl.includes('localhost') || appUrl.includes('127.0.0.1');

  if (!isLocalhost) {
    await waitForWebhookBind(serviceClient, userId);
    // Drop any snapshot the webhook didn't consume so a later stray event can't
    // re-bind off it.
    await serviceClient.database
      .from('unipile_connect_snapshots')
      .delete()
      .eq('user_id', userId);
    const { data: rows } = await client.database
      .from('social_accounts')
      .select('id')
      .eq('user_id', userId)
      .eq('workspace_id', workspaceId)
      .not('unipile_account_id', 'is', null);
    const synced = rows?.length ?? 0;
    return {
      synced,
      workspaceId,
      message: synced ? undefined : 'Awaiting connection confirmation',
    };
  }

  // Localhost only: the webhook can't reach a dev machine, so fall back to the
  // snapshot-diff bind. Safe here because a dev tenant has a single connector.
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

  if (accounts.length === 0) {
    return { synced: 0, workspaceId, message: 'No accounts found in Unipile' };
  }

  // Pre-connect snapshot written by /connect/unipile. Its absence means this
  // call is NOT a fresh connect (e.g. a settings-page load) - bind nothing, so
  // we never re-derive identity from the shared list (the old cross-wiring bug).
  const { data: snapRow } = await serviceClient.database
    .from('unipile_connect_snapshots')
    .select('account_ids, created_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (!snapRow) {
    return { synced: 0, workspaceId, message: 'No pending connect - nothing to bind' };
  }
  // Expired permit = no proof of an in-flight login. This is the path that
  // produced "Connected as <name>" with no OAuth at all: an abandoned connect
  // left a permanent snapshot, and a later automatic sync (opening Voice Lab or
  // Settings calls this without the user asking) bound whatever account had
  // since appeared in the shared tenant.
  if (isSnapshotExpired((snapRow as { created_at?: string }).created_at)) {
    await serviceClient.database.from('unipile_connect_snapshots').delete().eq('user_id', userId);
    return { synced: 0, workspaceId, message: 'Connect expired — start the connect again' };
  }
  const snapshotIds = new Set(
    ((snapRow as { account_ids?: string[] }).account_ids ?? []).filter(Boolean),
  );

  const { data: allClaimed } = await serviceClient.database
    .from('social_accounts')
    .select('unipile_account_id, account_id, user_id')
    .not('unipile_account_id', 'is', null)
    .neq('user_id', userId);

  const claimedByOthers = new Set(
    (allClaimed ?? [])
      .flatMap((r) => {
        const row = r as { unipile_account_id?: string | null; account_id?: string | null };
        return [row.unipile_account_id, row.account_id].map(normalizedIdentity);
      })
      .filter((token): token is string => Boolean(token)),
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
    // Reap this LinkedIn's stale duplicate boxes so dev reconnects don't pile up.
    if (accountId) await pruneDuplicateUnipileAccounts(account.id, accountId);
    synced++;
  }

  await clearSnapshot();
  return { synced, workspaceId };
}
