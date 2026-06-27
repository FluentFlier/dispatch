import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { unipoleFetch } from '@/lib/social/unipile';

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

/**
 * POST /api/social-accounts/sync
 *
 * Polls Unipile GET /accounts, then upserts any connected accounts into
 * social_accounts for the current user.
 *
 * This is the fallback path for local development where the Unipile webhook
 * cannot reach localhost. In production the webhook (/api/webhooks/unipile)
 * fires automatically and stores accounts — this endpoint is called on the
 * success_redirect so localhost dev works without ngrok.
 */
export async function POST(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!process.env.UNIPILE_API_KEY || !process.env.UNIPILE_DSN) {
    return NextResponse.json({ error: 'Unipile not configured' }, { status: 503 });
  }

  const res = await unipoleFetch('/accounts', { method: 'GET' });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('[sync/unipile] GET /accounts failed:', res.status, body.slice(0, 200));
    return NextResponse.json(
      { error: `Unipile accounts fetch failed (${res.status})` },
      { status: 502 },
    );
  }

  const rawData = await res.json() as Record<string, unknown>;
  console.log('[sync/unipile] raw response:', JSON.stringify(rawData).slice(0, 1000));

  // Unipile may use 'items', 'accounts', or 'data' depending on API version.
  const accounts: UnipileAccount[] = (
    (rawData.items as UnipileAccount[] | undefined) ??
    (rawData.accounts as UnipileAccount[] | undefined) ??
    (rawData.data as UnipileAccount[] | undefined) ??
    []
  );

  if (accounts.length === 0) {
    return NextResponse.json({ synced: 0, message: 'No accounts found in Unipile' });
  }

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);

  // Deduplicate by id — Unipile can return the same account twice if reconnected.
  const seen = new Set<string>();
  const dedupedAccounts = accounts.filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });

  let synced = 0;
  for (const account of dedupedAccounts) {
    // API list response uses 'type'; webhook payload uses 'provider'.
    const providerRaw = (account.type ?? account.provider ?? '').toLowerCase();
    const platform =
      providerRaw === 'linkedin' ? 'linkedin' :
        providerRaw === 'twitter' || providerRaw === 'x' || providerRaw === 'twitter_v2' ? 'twitter' :
          providerRaw === 'instagram' ? 'instagram' :
            providerRaw === 'threads' ? 'threads' :
              null;

    if (!platform) continue;

    // Extract display name and username from nested connection_params if available.
    const accountName = account.name ?? account.connection_params?.im?.username ?? null;
    const accountId = account.connection_params?.im?.publicIdentifier ?? account.username ?? null;

    await client.database
      .from('social_accounts')
      .upsert(
        {
          user_id: user.id,
          workspace_id: workspaceId,
          platform,
          unipile_account_id: account.id,
          account_name: accountName,
          account_id: accountId,
          // access_token is NOT NULL in schema; Unipile manages auth internally.
          access_token: '',
          connection_method: 'unipile',
          connected_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,platform' },
      );
    synced++;
  }

  return NextResponse.json({ synced });
}
