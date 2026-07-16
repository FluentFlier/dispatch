import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { isComposioConfigured } from '@/lib/composio/config';
import { getIntegration } from '@/lib/signals/integrations/store';
import { listSlackChannels } from '@/lib/composio/actions/slack';
import { errorResponse } from '@/lib/api-errors';

/**
 * GET /api/signals/integrations/slack/channels
 * Lists the connected Slack workspace's channels so the delivery UI can offer a
 * channel picker. Requires Slack to be connected via Composio first.
 */
export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  if (!isComposioConfigured()) {
    return NextResponse.json({ error: 'Composio is not configured' }, { status: 503 });
  }

  try {
    const client = getServerClient();
    const integration = await getIntegration(client, workspaceId, 'slack');
    if (!integration?.enabled) {
      return NextResponse.json({ error: 'Connect Slack first.' }, { status: 404 });
    }

    const result = await listSlackChannels(integration.composio_user_id);
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 502 });
    }

    return NextResponse.json({ channels: result.channels });
  } catch (err) {
    return errorResponse('Could not list Slack channels.', 500, err);
  }
}
