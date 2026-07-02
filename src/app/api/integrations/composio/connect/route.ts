import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { startComposioConnect } from '@/lib/composio/connect';
import { isComposioConfigured } from '@/lib/composio/config';

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
export async function GET(_request: NextRequest): Promise<NextResponse> {
  if (!isComposioConfigured()) {
    return NextResponse.json({ error: 'Composio is not configured' }, { status: 503 });
  }

  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  // Composio can reject at link time (invalid/expired COMPOSIO_API_KEY, missing
  // auth config, transient outage). This is a browser GET navigation, so surface
  // a clean redirect back to Settings with an error flag instead of a raw 500 stack.
  try {
    const { redirectUrl } = await startComposioConnect(workspaceId, user.id, 'googlecalendar');
    return NextResponse.redirect(redirectUrl);
  } catch (err) {
    console.error('[composio:connect] Google Calendar connect failed', err);
    const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
    return NextResponse.redirect(`${base}/settings?tab=connections&calendar_error=connect_failed`);
  }
}
