import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServiceClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { errorResponse } from '@/lib/api-errors';
import { disconnectComposioToolkit } from '@/lib/composio/connect';
import { toComposioUserId } from '@/lib/composio/client';
import { getIntegration } from '@/lib/signals/integrations/store';
import type { ComposioToolkit } from '@/lib/composio/config';

/**
 * Shared disconnect handler for every Composio toolkit (Gmail, Slack, Google
 * Calendar). One implementation because the ordering below is easy to get
 * subtly wrong, and three copies would drift:
 *
 *   1. Revoke at Composio FIRST. The status badge reads live Composio state, so
 *      clearing only the local marker leaves the account genuinely connected -
 *      the button appears to do nothing and the OAuth grant survives.
 *   2. If Composio cannot be reached, change NOTHING and fail loudly. Clearing
 *      the local row would tell the user they are disconnected while the
 *      provider still holds a live grant on their mailbox or calendar.
 *   3. Only once the grant is actually gone, clear the local row.
 */
export async function handleComposioDisconnect(toolkit: ComposioToolkit): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  try {
    const client = getServiceClient();

    // Revoke against the entity the connection was actually made under, falling
    // back to the derived id when the row predates that column.
    const integration = await getIntegration(client, workspaceId, toolkit);
    const entityId = integration?.composio_user_id ?? toComposioUserId(workspaceId, user.id);

    const revoked = await disconnectComposioToolkit(entityId, toolkit);
    if (revoked === null) {
      return NextResponse.json(
        { error: 'Could not reach the integration provider to revoke access. Try again.' },
        { status: 502 },
      );
    }

    const { error } = await client.database
      .from('signal_integrations')
      .update({
        connected_by_user_id: null,
        enabled: false,
        updated_at: new Date().toISOString(),
      })
      .eq('workspace_id', workspaceId)
      .eq('toolkit', toolkit);

    if (error) return errorResponse('Could not disconnect.', 500, error);

    return NextResponse.json({ ok: true, revoked });
  } catch (err) {
    return errorResponse('Could not disconnect.', 500, err);
  }
}
