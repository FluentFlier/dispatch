import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { isComposioToolkitConnected } from '@/lib/composio/connect';
import { toComposioUserId } from '@/lib/composio/client';
import { decodeComposioState } from '@/lib/composio/state';
import { upsertIntegration } from '@/lib/signals/integrations/store';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const redirectBase = `${base}/settings?tab=connections`;

  const state = decodeComposioState(request.nextUrl.searchParams.get('state'));
  if (!state) {
    return NextResponse.redirect(`${redirectBase}&outreach_error=${encodeURIComponent('invalid_state')}`);
  }

  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.redirect(`${base}/login?next=${encodeURIComponent('/leads')}`);
  }

  if (user.id !== state.userId) {
    return NextResponse.redirect(`${redirectBase}&outreach_error=wrong_user`);
  }

  const activeWorkspaceId = await getActiveWorkspaceId(user.id);
  if (!activeWorkspaceId || activeWorkspaceId !== state.workspaceId) {
    return NextResponse.redirect(`${redirectBase}&outreach_error=wrong_workspace`);
  }

  const status = request.nextUrl.searchParams.get('status');
  if (status === 'failed') {
    return NextResponse.redirect(`${redirectBase}&outreach_error=connect_failed`);
  }

  try {
    const composioUserId = toComposioUserId(state.workspaceId, state.userId);
    const connected = await isComposioToolkitConnected(composioUserId, state.toolkit);
    if (!connected) {
      return NextResponse.redirect(`${redirectBase}&outreach_error=not_connected`);
    }

    const client = getServerClient();
    // Google Calendar (Event Capture v1) defaults to the user's primary
    // calendar so the sync job has a target immediately after connecting; the
    // user can switch calendars later. Other toolkits carry no config here, so
    // upsertIntegration preserves any existing config (or falls back to {}).
    const config =
      state.toolkit === 'googlecalendar' ? { calendar_id: 'primary' } : undefined;
    await upsertIntegration(client, {
      workspaceId: state.workspaceId,
      toolkit: state.toolkit,
      composioUserId,
      connectedByUserId: state.userId,
      enabled: true,
      config,
    });

    if (state.returnTo?.startsWith('/')) {
      const sep = state.returnTo.includes('?') ? '&' : '?';
      return NextResponse.redirect(
        `${base}${state.returnTo}${sep}outreach_connected=${state.toolkit}`,
      );
    }

    return NextResponse.redirect(`${redirectBase}&outreach_connected=${state.toolkit}`);
  } catch {
    return NextResponse.redirect(`${redirectBase}&outreach_error=save_failed`);
  }
}
