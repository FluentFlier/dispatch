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

  const seen = new Set<string>();
  const dedupedAccounts = accounts.filter((account) => {
    if (seen.has(account.id)) return false;
    seen.add(account.id);
    return true;
  });

  let synced = 0;
  for (const account of dedupedAccounts) {
    if (claimedByOthers.has(account.id)) {
      console.warn('[sync/unipile] Skipping account owned by another user:', `${account.id.slice(0, 8)}...`);
      continue;
    }

    const platform = mapUnipilePlatform(account);
    if (!platform) continue;

    const accountName = account.name ?? account.connection_params?.im?.username ?? null;
    const accountId = account.connection_params?.im?.publicIdentifier ?? account.username ?? null;

    console.log(
      `[sync/unipile] ${platform} account_id (publicIdentifier):`,
      accountId,
      '| unipile_id:',
      `${account.id.slice(0, 8)}...`,
    );

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

  return { synced, workspaceId };
}
