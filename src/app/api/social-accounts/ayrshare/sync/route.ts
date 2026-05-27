import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getSocialProvider } from '@/lib/social';
import { encryptToken } from '@/lib/crypto';
import { getSocialProviderMode } from '@/lib/env';

/** POST: Sync Ayrshare connected accounts into social_accounts table */
export async function POST(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (getSocialProviderMode() !== 'ayrshare') {
    return NextResponse.json({ error: 'Ayrshare mode not active' }, { status: 400 });
  }

  const provider = getSocialProvider();
  const accounts = await provider.listAccounts(user.id);
  const client = getServerClient();

  for (const acct of accounts) {
    await client.database.from('social_accounts').upsert(
      [
        {
          user_id: user.id,
          platform: acct.platform,
          account_name: acct.accountName,
          account_id: acct.accountId,
          access_token: encryptToken('ayrshare-managed'),
          connection_method: 'oauth',
          provider: 'ayrshare',
          health_status: acct.healthStatus,
          connected_at: new Date().toISOString(),
        },
      ],
      { onConflict: 'user_id,platform' }
    );
  }

  return NextResponse.json({ synced: accounts.length, accounts });
}
