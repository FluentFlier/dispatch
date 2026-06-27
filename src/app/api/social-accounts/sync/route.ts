import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient, getServiceClient } from '@/lib/insforge/server';
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
 * Polls Unipile GET /accounts, then stores connected accounts for the current user.
 *
 * This is the fallback path for local development where the Unipile webhook
 * cannot reach localhost. In production the webhook (/api/webhooks/unipile)
 * fires automatically and stores accounts — this endpoint is called on the
 * success_redirect so localhost dev works without ngrok.
 *
 * Security: Unipile's GET /accounts returns ALL accounts for the shared API key
 * (all Content OS users). We cross-check against the service client to skip any
 * account already claimed by a different user — preventing cross-user contamination.
 *
 * Workspace preservation: on UPDATE we never overwrite workspace_id so users who
 * switch active workspaces between syncs don't lose their account association.
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

  // --- Build set of unipile_account_ids owned by OTHER users ---
  // Service client bypasses RLS so we can see all users' rows.
  // This prevents claiming an account that already belongs to someone else.
  const serviceClient = getServiceClient();
  const { data: allClaimed } = await serviceClient.database
    .from('social_accounts')
    .select('unipile_account_id, user_id')
    .not('unipile_account_id', 'is', null)
    .neq('user_id', user.id);

  const claimedByOthers = new Set(
    (allClaimed ?? [])
      .map((r) => (r as { unipile_account_id: string }).unipile_account_id)
      .filter(Boolean),
  );

  // Deduplicate by id — Unipile can return the same account twice if reconnected.
  const seen = new Set<string>();
  const dedupedAccounts = accounts.filter((a) => {
    if (seen.has(a.id)) return false;
    seen.add(a.id);
    return true;
  });

  let synced = 0;
  for (const account of dedupedAccounts) {
    // Skip accounts already owned by another user — prevents cross-user data leakage.
    if (claimedByOthers.has(account.id)) {
      console.warn('[sync/unipile] Skipping account owned by another user:', account.id.slice(0, 8) + '...');
      continue;
    }

    // API list response uses 'type'; webhook payload uses 'provider'.
    const providerRaw = (account.type ?? account.provider ?? '').toLowerCase();
    const platform =
      providerRaw === 'linkedin' ? 'linkedin' :
        providerRaw === 'twitter' || providerRaw === 'x' || providerRaw === 'twitter_v2' ? 'twitter' :
          providerRaw === 'instagram' ? 'instagram' :
            providerRaw === 'threads' ? 'threads' :
              null;

    if (!platform) continue;

    const accountName = account.name ?? account.connection_params?.im?.username ?? null;
    // publicIdentifier is the LinkedIn provider user ID used in /users/{id}/posts.
    const accountId = account.connection_params?.im?.publicIdentifier ?? account.username ?? null;

    // Temp: log what publicIdentifier returns so we can verify it's the right LinkedIn ID format.
    console.log(`[sync/unipile] ${platform} account_id (publicIdentifier):`, accountId, '| unipile_id:', account.id.slice(0, 8) + '...');

    // Check if user already has a row for this platform.
    // UPDATE preserves workspace_id (user may have switched active workspace since last sync).
    // INSERT sets workspace_id from the currently active workspace.
    const { data: existing } = await client.database
      .from('social_accounts')
      .select('id')
      .eq('user_id', user.id)
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
        });
    }
    synced++;
  }

  return NextResponse.json({ synced });
}
