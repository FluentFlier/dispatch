import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/insforge/server';

/**
 * GET /api/social-accounts/connect/unipile
 * Redirects the user to the Unipile hosted connect flow.
 * Unipile handles the OAuth for LinkedIn and X — the user selects which platform to connect.
 * On success Unipile fires our webhook (/api/webhooks/unipile) with the account_id.
 */
export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.UNIPILE_API_KEY;
  const dsn = process.env.UNIPILE_DSN;

  if (!apiKey || !dsn) {
    return NextResponse.json(
      { error: 'Unipile is not configured. Set UNIPILE_API_KEY and UNIPILE_DSN in environment variables.' },
      { status: 500 },
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  // Unipile hosted-connect URL uses the DSN host, not the API base.
  // DSN format: api54.unipile.com:18402
  const hostedConnectBase = `https://${dsn.replace(/\/$/, '')}/hosted-connect`;

  const params = new URLSearchParams({
    api_key: apiKey,
    success_redirect: `${appUrl}/settings?tab=connections&connected=true`,
    failure_redirect: `${appUrl}/settings?tab=connections&error=unipile_failed`,
    state: user.id,
  });

  return NextResponse.redirect(`${hostedConnectBase}?${params.toString()}`);
}
