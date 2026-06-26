import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { unipoleFetch } from '@/lib/social/unipile';

interface UnipileAccount {
  id: string;
  provider: string;
  username?: string;
  name?: string;
  connection_status?: string;
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

  const data = (await res.json()) as { items?: UnipileAccount[] };
  const accounts = data.items ?? [];

  if (accounts.length === 0) {
    return NextResponse.json({ synced: 0, message: 'No accounts found in Unipile' });
  }

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);

  let synced = 0;
  for (const account of accounts) {
    const providerLower = account.provider?.toLowerCase() ?? '';
    const platform =
      providerLower === 'linkedin' ? 'linkedin' :
      providerLower === 'twitter' || providerLower === 'x' || providerLower === 'twitter_v2' ? 'twitter' :
      providerLower === 'instagram' ? 'instagram' :
      providerLower === 'threads' ? 'threads' :
      null;

    if (!platform) continue;

    await client.database
      .from('social_accounts')
      .upsert(
        {
          user_id: user.id,
          workspace_id: workspaceId,
          platform,
          unipile_account_id: account.id,
          account_name: account.name ?? account.username ?? null,
          account_id: account.username ?? null,
          connection_method: 'unipile',
          connected_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,platform' },
      );
    synced++;
  }

  return NextResponse.json({ synced });
}
