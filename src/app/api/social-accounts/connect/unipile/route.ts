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

  // api_url = the Unipile server URL (required). notify_url = our webhook (optional).
  const requestBody: Record<string, unknown> = {
    type: 'create',
    // Required: Unipile server URL — not our webhook, the Unipile API base.
    api_url: `https://${dsn.replace(/\/$/, '')}`,
    // Required: link expiry (ISO 8601 UTC). Unipile also expires on daily restart.
    expiresOn: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    // Providers to show (schema enum: LINKEDIN | TWITTER | INSTAGRAM | MESSENGER | TELEGRAM | GOOGLE | OUTLOOK | MAIL)
    providers: ['LINKEDIN', 'TWITTER'],
    success_redirect_url: `${appUrl}/settings?tab=connections&connected=true`,
    failure_redirect_url: `${appUrl}/settings?tab=connections&error=unipile_failed`,
    // name gets sent back in notify_url payload so we can match user
    name: user.id,
  };

  // notify_url = our webhook, only set in deployed environments (localhost unreachable).
  // On localhost the success_redirect calls /api/social-accounts/sync as fallback.
  if (!isLocalhost) {
    requestBody.notify_url = `${appUrl}/api/webhooks/unipile`;
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
