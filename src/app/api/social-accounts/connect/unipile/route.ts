import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/insforge/server';

/**
 * GET /api/social-accounts/connect/unipile
 *
 * Calls Unipile POST /api/v1/hosted/accounts/link to generate a hosted
 * connect session URL, then redirects the user there. Unipile handles the
 * OAuth for LinkedIn and X; on success it fires our webhook
 * (/api/webhooks/unipile) with the connected account_id.
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
      { error: 'Unipile is not configured. Set UNIPILE_API_KEY and UNIPILE_DSN.' },
      { status: 500 },
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';
  const apiBase = `https://${dsn.replace(/\/$/, '')}/api/v1`;

  // Step 1: ask Unipile to create a hosted auth session and return a link_url.
  const res = await fetch(`${apiBase}/hosted/accounts/link`, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      type: 'create',
      // Only show LinkedIn and X — add more providers here as needed.
      providers_filter: ['LINKEDIN', 'TWITTER'],
      // The webhook URL Unipile calls after the user authenticates.
      api_url: `${appUrl}/api/webhooks/unipile`,
      success_redirect_url: `${appUrl}/settings?tab=connections&connected=true`,
      failure_redirect_url: `${appUrl}/settings?tab=connections&error=unipile_failed`,
      // Embed the user ID so the webhook knows which user to associate.
      name: user.id,
      // Link expires in 10 minutes.
      expiresOn: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error('[unipile/connect] hosted link creation failed:', res.status, body.slice(0, 300));
    return NextResponse.json(
      { error: `Unipile hosted connect failed (${res.status}). Check UNIPILE_API_KEY and UNIPILE_DSN.` },
      { status: 502 },
    );
  }

  const data = (await res.json()) as { url?: string; link_url?: string };
  const linkUrl = data.url ?? data.link_url;

  if (!linkUrl) {
    console.error('[unipile/connect] no url in response:', JSON.stringify(data));
    return NextResponse.json(
      { error: 'Unipile did not return a connect URL. Check API key permissions.' },
      { status: 502 },
    );
  }

  // Step 2: redirect user to the Unipile-hosted connect page.
  return NextResponse.redirect(linkUrl);
}
