import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { startComposioConnect } from '@/lib/composio/connect';
import { composioAppBaseUrl, isComposioConfigured, isComposioToolkitReady } from '@/lib/composio/config';

function settingsRedirect(base: string, calendarError: string): NextResponse {
  return NextResponse.redirect(
    `${base}/settings?tab=connections&calendar_error=${encodeURIComponent(calendarError)}`,
  );
}

/**
 * Starts the Composio hosted OAuth flow for the Google Calendar toolkit and
 * redirects the browser straight to Composio's consent screen. This is the
 * server-redirect entrypoint for Event Capture v1: unlike the sibling `/link`
 * route (which returns the redirect URL as JSON for a client-driven fetch),
 * this route can be linked to directly so a plain <a href> or GET navigation
 * lands the user on the consent page. On return, the existing
 * /api/integrations/composio/callback verifies the connection and upserts the
 * signal_integrations row.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const base = composioAppBaseUrl(request.nextUrl.origin);

  if (!isComposioConfigured()) {
    return settingsRedirect(base, 'composio_not_configured');
  }

  if (!isComposioToolkitReady('googlecalendar')) {
    return settingsRedirect(base, 'auth_config_missing');
  }

  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.redirect(`${base}/login?next=${encodeURIComponent('/settings?tab=connections')}`);
  }

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) {
    return settingsRedirect(base, 'connect_failed');
  }

  const returnTo = '/settings?tab=connections';

  // Composio can reject at link time (invalid/expired COMPOSIO_API_KEY, missing
  // auth config, transient outage). This is a browser GET navigation, so surface
  // a clean redirect back to Settings with an error flag instead of a raw 500 stack.
  try {
    const { redirectUrl } = await startComposioConnect(
      workspaceId,
      user.id,
      'googlecalendar',
      returnTo,
      request.nextUrl.origin,
    );
    return NextResponse.redirect(redirectUrl);
  } catch (err) {
    console.error('[composio:connect] Google Calendar connect failed', err);
    const message = err instanceof Error ? err.message : '';
    const code = message.includes('Missing auth config') ? 'auth_config_missing' : 'connect_failed';
    return settingsRedirect(base, code);
  }
}
