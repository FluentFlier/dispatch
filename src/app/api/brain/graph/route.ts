import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { listBrainPages } from '@/lib/brain/pages';
import { buildBrainGraph } from '@/lib/brain/graph';
import { getActiveWorkspaceId } from '@/lib/workspace';

/**
 * Returns the creator's brain as a node/edge graph for visualization.
 * Scoped to the active workspace so agency clients never see each other's brain.
 */
export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();

  try {
    const workspaceId = (await getActiveWorkspaceId(user.id)) ?? undefined;
    const pages = await listBrainPages(client, user.id, workspaceId);
    const graph = buildBrainGraph(pages);

    return NextResponse.json({
      provisioned: pages.length > 0,
      page_count: pages.length,
      last_updated: pages[0]?.updated_at ?? null,
      ...graph,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Brain unavailable';
    if (message.includes('creator_brain_pages') || message.includes('does not exist')) {
      return NextResponse.json({
        provisioned: false,
        page_count: 0,
        last_updated: null,
        nodes: [],
        edges: [],
        migration_required: true,
        message: 'Run db/creator-brain.sql on InsForge',
      });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
