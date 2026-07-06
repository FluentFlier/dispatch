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
import { errorResponse } from '@/lib/api-errors';

const bodySchema = z.object({
  description: z.string().min(10).max(4000),
  discover: z.boolean().optional(),
});

/**
 * POST /api/leads/icp
 * Describe your ICP in natural language → structured settings + GTM playbook.
 * Optionally runs lead discovery (YC Algolia + TinyFish agent) immediately.
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
    const icp = await parseIcpDescription(parsed.data.description);

    await updateDirectorySettings(client, workspaceId, {
      icp_description: parsed.data.description.trim(),
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

    let sync = null;
    if (parsed.data.discover !== false) {
      sync = await syncWorkspaceDirectory(client, workspaceId);
    }

    const settings = await getDirectorySettings(client, workspaceId);

    return NextResponse.json({
      settings,
      parsed: {
        icp_verticals: icp.icp_verticals,
        icp_keywords: icp.icp_keywords,
        discovery_goal: icp.discovery_goal,
      },
      sync,
    });
  } catch (err) {
    return errorResponse('Could not apply ICP.', 500, err);
  }
}
