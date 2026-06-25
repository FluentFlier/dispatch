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
  if (!apiKey) {
    return NextResponse.json(
      { error: 'Unipile API not configured' },
      { status: 500 },
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  // Build the Unipile hosted connect URL.
  // The success_redirect and failure_redirect must be pre-registered with Unipile.
  const params = new URLSearchParams({
    // Unipile uses the API key in the URL for hosted connect flows.
    api_key: apiKey,
    success_redirect: `${appUrl}/settings/social?connected=true`,
    failure_redirect: `${appUrl}/settings/social?error=unipile_failed`,
    // Pass the user ID as state so the webhook knows which user to associate the account with.
    state: user.id,
  });

  const unipileConnectUrl = `https://api2.unipile.com/hosted-connect?${params.toString()}`;

  return NextResponse.redirect(unipileConnectUrl);
}
