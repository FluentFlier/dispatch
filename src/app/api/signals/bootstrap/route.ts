import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { isComposioConfigured } from '@/lib/composio/config';
import { getLinkedInUnipileAccountId } from '@/lib/signals/outreach/unipile-linkedin';
import { listIntegrations } from '@/lib/signals/integrations/store';
import { getSafetyStatus } from '@/lib/signals/safety';
import { ensureDefaultSources, ensureGtmPlaybook, listEvents, listSources } from '@/lib/signals/store';
import { errorResponse } from '@/lib/api-errors';

const TOOLKITS = ['slack', 'gmail', 'googlecalendar'] as const;

/**
 * GET /api/signals/bootstrap
 * Single round-trip for Signals page load (events, safety, sources, LinkedIn, integrations).
 * Skips slow external calls (Composio live status, Unipile InMail balance).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) {
    return NextResponse.json({ error: 'No active workspace' }, { status: 400 });
  }

  const params = request.nextUrl.searchParams;
  const status = params.get('status') ?? undefined;
  const signalType = params.get('signal_type') ?? undefined;
  const limit = parseInt(params.get('limit') ?? '50', 10);

  try {
    const client = getServerClient();

    await ensureDefaultSources(client, workspaceId);
    await ensureGtmPlaybook(client, user.id, workspaceId);

    const [events, safety, sources, accountId, integrationRows] = await Promise.all([
      listEvents(client, workspaceId, { status, signalType, limit }),
      getSafetyStatus(client, workspaceId),
      listSources(client, workspaceId),
      getLinkedInUnipileAccountId(client, user.id, workspaceId),
      listIntegrations(client, workspaceId),
    ]);

    const integrations = TOOLKITS.map((toolkit) => {
      const row = integrationRows.find((r) => r.toolkit === toolkit);
      return {
        toolkit,
        connected: Boolean(row?.connected_by_user_id),
        enabled: row?.enabled ?? false,
        config: row?.config ?? {},
      };
    });

    return NextResponse.json({
      events,
      safety,
      sources,
      linkedIn: {
        connected: Boolean(accountId),
        account_id: accountId ?? undefined,
        inmail: null,
      },
      integrations,
      composio_configured: isComposioConfigured(),
    });
  } catch (err) {
    return errorResponse('Could not load Signals.', 500, err);
  }
}
