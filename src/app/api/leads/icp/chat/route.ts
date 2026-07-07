import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { getWorkspaceOwnerUserId } from '@/lib/signals/ingest/workspace-account';
import { updateDirectorySettings, getDirectorySettings } from '@/lib/signals/leads/store';
import { putBrainPage } from '@/lib/brain/pages';
import { BRAIN_SLUG } from '@/lib/brain/types';
import { parseIcpDescription } from '@/lib/signals/icp/parse-description';
import { syncWorkspaceDirectory } from '@/lib/signals/ingest/sync-directory';
import { runIcpChatTurn } from '@/lib/signals/icp/chat';
import { errorResponse } from '@/lib/api-errors';

const bodySchema = z.object({
  message: z.string().min(1).max(4000),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(4000),
      }),
    )
    .max(40)
    .optional(),
});

/**
 * POST /api/leads/icp/chat
 * Conversational ICP setup. Each turn: the assistant replies, optionally
 * rewrites + persists the consolidated ICP description (updating structured
 * filters + the GTM playbook), and optionally runs lead discovery when asked.
 * Shares the persistence path with POST /api/leads/icp so both entry points
 * stay consistent.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  try {
    const client = getServerClient();
    const existing = await getDirectorySettings(client, workspaceId);

    const decision = await runIcpChatTurn({
      message: parsed.data.message,
      history: parsed.data.history ?? [],
      currentDescription: existing?.icp_description ?? null,
    });

    let applied = false;
    if (decision.icpDescription) {
      const icp = await parseIcpDescription(decision.icpDescription);
      await updateDirectorySettings(client, workspaceId, {
        icp_description: decision.icpDescription,
        icp_verticals: icp.icp_verticals,
        icp_keywords: icp.icp_keywords,
      });
      const ownerId = (await getWorkspaceOwnerUserId(client, workspaceId)) ?? user.id;
      await putBrainPage(client, ownerId, {
        slug: BRAIN_SLUG.gtm,
        title: 'GTM playbook',
        tags: ['gtm', 'signals', 'outreach'],
        body: JSON.stringify({ ...icp.gtm, status: 'ready' }, null, 2),
        workspaceId,
      });
      applied = true;
    }

    let sync: { inserted?: number } | null = null;
    if (decision.discover) {
      sync = await syncWorkspaceDirectory(client, workspaceId);
    }

    // Return fresh settings only when something changed, so the client can
    // refresh its filter chips without an extra round-trip.
    const settings = applied ? await getDirectorySettings(client, workspaceId) : undefined;

    return NextResponse.json({
      assistantMessage: decision.reply,
      settings,
      applied,
      discoveryRan: decision.discover,
      sync,
    });
  } catch (err) {
    return errorResponse('Could not process ICP chat.', 500, err);
  }
}
