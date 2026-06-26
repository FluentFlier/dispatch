import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/insforge/server';

/**
 * GET /api/social-accounts/connect/unipile
 *
 * Calls Unipile POST /api/v1/hosted/accounts/link to generate a hosted
 * connect session URL, then redirects the user there.
 *
 * Webhook (api_url) is only set in production — on localhost Unipile can't
 * reach the server, so the success redirect instead calls
 * POST /api/social-accounts/sync to poll and store accounts.
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

  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const apiBase = `https://${dsn.replace(/\/$/, '')}/api/v1`;
  const isLocalhost = appUrl.includes('localhost') || appUrl.includes('127.0.0.1');

  const requestBody: Record<string, unknown> = {
    type: 'create',
    // LINKEDIN and TWITTER_V2 are the correct provider identifiers in Unipile.
    providers_filter: ['LINKEDIN', 'TWITTER_V2'],
    success_redirect_url: `${appUrl}/settings?tab=connections&connected=true`,
    failure_redirect_url: `${appUrl}/settings?tab=connections&error=unipile_failed`,
  };

  // Only register the webhook in deployed environments — localhost is unreachable.
  if (!isLocalhost) {
    requestBody.api_url = `${appUrl}/api/webhooks/unipile`;
  }

  console.log('[unipile/connect] POST', `${apiBase}/hosted/accounts/link`, JSON.stringify(requestBody));

  const res = await fetch(`${apiBase}/hosted/accounts/link`, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  });

  const rawBody = await res.text();

  if (!res.ok) {
    console.error('[unipile/connect] failed:', res.status, rawBody);
    // Return the raw Unipile error so we can see exactly what's wrong.
    return NextResponse.json(
      {
        error: `Unipile hosted connect failed (${res.status})`,
        unipile_error: rawBody,
      },
      { status: 502 },
    );
  }

  let data: { url?: string; link_url?: string };
  try {
    data = JSON.parse(rawBody);
  } catch {
    console.error('[unipile/connect] invalid JSON response:', rawBody);
    return NextResponse.json({ error: 'Unipile returned invalid JSON', raw: rawBody }, { status: 502 });
  }

  const linkUrl = data.url ?? data.link_url;

  if (!linkUrl) {
    console.error('[unipile/connect] no url in response:', rawBody);
    return NextResponse.json(
      { error: 'Unipile did not return a connect URL', response: data },
      { status: 502 },
    );
  }

  return NextResponse.redirect(linkUrl);
}
