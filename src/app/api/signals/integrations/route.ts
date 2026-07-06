import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { isComposioToolkitConnected } from '@/lib/composio/connect';
import { isComposioConfigured, isComposioToolkitReady } from '@/lib/composio/config';
import { toComposioUserId } from '@/lib/composio/client';
import { listIntegrations, patchIntegrationConfig } from '@/lib/signals/integrations/store';
import { errorResponse } from '@/lib/api-errors';

const PatchSchema = z.object({
  toolkit: z.enum(['slack', 'gmail', 'googlecalendar']),
  enabled: z.boolean().optional(),
  slack_channel_id: z.string().max(80).optional(),
  slack_channel_name: z.string().max(120).optional(),
  notify_on_new_signal: z.boolean().optional(),
}).strict();

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  const liveCheck = request.nextUrl.searchParams.get('live') === 'true';
  const composioConfigured = isComposioConfigured();
  const composioUserId = toComposioUserId(workspaceId, user.id);

  try {
    const client = getServerClient();
    const rows = await listIntegrations(client, workspaceId);

    const toolkits = ['slack', 'gmail', 'googlecalendar'] as const;
    const toolkitReady = Object.fromEntries(
      toolkits.map((toolkit) => [toolkit, isComposioToolkitReady(toolkit)]),
    ) as Record<(typeof toolkits)[number], boolean>;

    const integrations = await Promise.all(
      toolkits.map(async (toolkit) => {
        const row = rows.find((r) => r.toolkit === toolkit);
        const entityId = row?.composio_user_id ?? composioUserId;
        const connectedFromDb = Boolean(row?.connected_by_user_id);
        const connected =
          liveCheck && composioConfigured
            ? await isComposioToolkitConnected(entityId, toolkit)
            : connectedFromDb;
        return {
          toolkit,
          connected,
          enabled: row?.enabled ?? false,
          config: row?.config ?? {},
        };
      }),
    );

    return NextResponse.json({ composio_configured: composioConfigured, toolkit_ready: toolkitReady, integrations });
  } catch (err) {
    return errorResponse('Could not load integration status.', 500, err);
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  let body: z.infer<typeof PatchSchema>;
  try {
    body = PatchSchema.parse(await request.json());
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  try {
    const client = getServerClient();
    const updated = await patchIntegrationConfig(client, workspaceId, body.toolkit, {
      enabled: body.enabled,
      slack_channel_id: body.slack_channel_id,
      slack_channel_name: body.slack_channel_name,
      notify_on_new_signal: body.notify_on_new_signal,
    });

    if (!updated) {
      return NextResponse.json(
        { error: `Connect ${body.toolkit} first via Composio.` },
        { status: 404 },
      );
    }

    return NextResponse.json({ integration: updated });
  } catch (err) {
    return errorResponse('Could not update integration.', 500, err);
  }
}
