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

  // Default to a live ACTIVE-only check against Composio. The DB flag
  // (connected_by_user_id) is written once at OAuth and never cleared when a
  // token EXPIRES or is revoked, so trusting it showed dead connections (e.g. an
  // expired Gmail token) as "connected" while every action failed. Callers that
  // explicitly want the cheap DB read can pass ?live=false.
  const liveCheck = request.nextUrl.searchParams.get('live') !== 'false';
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
        // `?? connectedFromDb`: the live probe answers null when Composio is
        // unreachable, and an unanswerable probe must fall back to the stored
        // flag rather than reporting a disconnection that did not happen.
        const live =
          liveCheck && composioConfigured
            ? await isComposioToolkitConnected(entityId, toolkit)
            : null;
        const connected = live ?? connectedFromDb;
        // Diagnostic for "it says not connected but it IS connected". The three
        // ways that happens are indistinguishable in the UI but obvious here:
        //   live=false            -> Composio genuinely has no ACTIVE grant
        //   live=null             -> probe failed, we fell back to the DB flag
        //   hasRow=false          -> no row for this workspace, so entityId was
        //                            DERIVED; if the connect happened in another
        //                            workspace the id will not match Composio's
        // Only when the answer is "not connected" - a connected toolkit needs no
        // explanation, and logging every poll drowned the dev console.
        if (process.env.NODE_ENV !== 'production' && !connected) {
          console.warn('[integrations] reporting NOT connected', {
            toolkit,
            entityId,
            hasRow: Boolean(row),
            rowEntityId: row?.composio_user_id ?? null,
            live,
            connectedFromDb,
            connected,
          });
        }
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
