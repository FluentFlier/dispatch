import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServiceClient } from '@/lib/insforge/server';
import {
  getUnipileApiBase,
  getUnipileApiKey,
  getUnipileServerUrl,
  isUnipileConfigured,
} from '@/lib/unipile/config';

/**
 * Snapshot the shared subscription's current account IDs BEFORE the user connects.
 * On return, /api/social-accounts/sync diffs against this to identify the exact
 * account THIS user just connected - the shared key's GET /accounts otherwise
 * gives no per-user signal. Best-effort: never blocks the connect flow.
 */
async function snapshotUnipileAccounts(userId: string, apiBase: string, apiKey: string) {
  try {
    const res = await fetch(`${apiBase}/accounts`, {
      headers: { 'X-API-KEY': apiKey, accept: 'application/json' },
      cache: 'no-store',
    });
    if (!res.ok) return;
    const data = (await res.json()) as Record<string, unknown>;
    const list =
      (data.items as Array<{ id?: string }> | undefined) ??
      (data.accounts as Array<{ id?: string }> | undefined) ??
      (data.data as Array<{ id?: string }> | undefined) ??
      [];
    const ids = list.map((a) => a.id).filter((id): id is string => Boolean(id));
    await getServiceClient()
      .database.from('unipile_connect_snapshots')
      .upsert(
        { user_id: userId, account_ids: ids, created_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      );
  } catch (err) {
    console.warn('[unipile/connect] snapshot failed (non-fatal):', err);
  }
}

/**
 * GET /api/social-accounts/connect/unipile
 *
 * Calls Unipile POST /api/v1/hosted/accounts/link to generate a hosted
 * connect session URL, then redirects the user there.
 *
 * Webhook (api_url) is only set in production - on localhost Unipile can't
 * reach the server, so the success redirect instead calls
 * POST /api/social-accounts/sync to poll and store accounts.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const returnTo = request.nextUrl.searchParams.get('return');
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const settingsReturn = returnTo === 'onboarding' || returnTo === 'settings';
  const successRedirect = settingsReturn
    ? returnTo === 'onboarding'
      ? `${appUrl}/onboarding?connected=true`
      : `${appUrl}/settings?tab=connections&connected=true`
    : `${appUrl}/settings?tab=connections&connected=true`;
  const failureRedirect = settingsReturn
    ? returnTo === 'onboarding'
      ? `${appUrl}/onboarding?error=connect_failed`
      : `${appUrl}/settings?tab=connections&error=unipile_failed`
    : `${appUrl}/settings?tab=connections&error=unipile_failed`;

  const apiKey = getUnipileApiKey();
  const apiBase = getUnipileApiBase();
  const serverUrl = getUnipileServerUrl();

  if (!isUnipileConfigured() || !apiKey || !apiBase || !serverUrl) {
    const message = encodeURIComponent(
      'Unipile is not configured on this deployment. Set UNIPILE_API_KEY and UNIPILE_DSN.',
    );
    return NextResponse.redirect(`${appUrl}/settings?tab=connections&error=${message}`);
  }

  const isLocalhost = appUrl.includes('localhost') || appUrl.includes('127.0.0.1');
  const production = process.env.NODE_ENV === 'production';
  const callbackSecret = process.env.UNIPILE_HOSTED_CALLBACK_SECRET
    ?? process.env.UNIPILE_WEBHOOK_SECRET
    ?? process.env.CRON_SECRET;

  if (production && isLocalhost) {
    console.error('[unipile/connect] refusing hosted link with localhost NEXT_PUBLIC_APP_URL in production');
    return NextResponse.redirect(failureRedirect);
  }

  if (production && !callbackSecret?.trim()) {
    console.error('[unipile/connect] refusing hosted link without callback secret in production');
    return NextResponse.redirect(failureRedirect);
  }

  // Scope the hosted flow to a single platform when the row's Connect button
  // passes ?provider=. Absent → show both (the all-at-once entry point).
  const PROVIDER_ENUM: Record<string, string> = {
    linkedin: 'LINKEDIN',
    twitter: 'TWITTER',
    x: 'TWITTER',
    instagram: 'INSTAGRAM',
  };
  const providerParam = request.nextUrl.searchParams.get('provider')?.toLowerCase();
  const scopedProvider = providerParam ? PROVIDER_ENUM[providerParam] : undefined;
  const providers = scopedProvider ? [scopedProvider] : ['LINKEDIN', 'TWITTER'];

  // Record which accounts already exist so the post-connect sync can pick out
  // the one this user is about to add (shared-key subscription has no per-user filter).
  await snapshotUnipileAccounts(user.id, apiBase, apiKey);

  // api_url = the Unipile server URL (required). notify_url = our webhook (optional).
  const requestBody: Record<string, unknown> = {
    type: 'create',
    // Required: Unipile server URL - not our webhook, the Unipile API base.
    api_url: serverUrl,
    // Required: link expiry (ISO 8601 UTC). Unipile also expires on daily restart.
    expiresOn: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    // Providers to show (schema enum: LINKEDIN | TWITTER | INSTAGRAM | MESSENGER | TELEGRAM | GOOGLE | OUTLOOK | MAIL)
    providers,
    success_redirect_url: successRedirect,
    failure_redirect_url: failureRedirect,
    // state is returned as payload.state in the account.connected webhook - used to identify the user.
    // name is a display label only; account.name in the webhook payload is the LinkedIn display name, not this value.
    name: user.id,
    state: user.id,
  };

  // notify_url = our webhook, only set in deployed environments (localhost unreachable).
  // On localhost the success_redirect calls /api/social-accounts/sync as fallback.
  if (!isLocalhost) {
    const notifyUrl = new URL(`${appUrl}/api/webhooks/unipile`);
    if (callbackSecret) {
      notifyUrl.searchParams.set('token', callbackSecret);
    }
    requestBody.notify_url = notifyUrl.toString();
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

  // On any failure, bounce back to the connections page with the inline error
  // flag instead of dumping raw JSON in the user's face. Details stay in logs.
  if (!res.ok) {
    console.error('[unipile/connect] failed:', res.status, rawBody);
    return NextResponse.redirect(failureRedirect);
  }

  let data: { url?: string; link_url?: string };
  try {
    data = JSON.parse(rawBody);
  } catch {
    console.error('[unipile/connect] invalid JSON response:', rawBody);
    return NextResponse.redirect(failureRedirect);
  }

  const linkUrl = data.url ?? data.link_url;

  if (!linkUrl) {
    console.error('[unipile/connect] no url in response:', rawBody);
    return NextResponse.redirect(failureRedirect);
  }

  return NextResponse.redirect(linkUrl);
}
