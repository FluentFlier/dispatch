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

  const { redirectUrl } = await startComposioConnect(workspaceId, user.id, 'googlecalendar');
  return NextResponse.redirect(redirectUrl);
}
