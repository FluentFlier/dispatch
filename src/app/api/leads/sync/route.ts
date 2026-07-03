import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { syncWorkspaceDirectory } from '@/lib/signals/ingest/sync-directory';
import { errorResponse } from '@/lib/api-errors';

/**
 * POST /api/leads/sync
 * Manual directory scrape for the active workspace (the "Scrape now" action).
 * Uses the seed provider when TINYFISH_API_KEY is absent so the flow is
 * testable end-to-end without live scraping.
 */
export async function POST(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  try {
    const client = getServerClient();
    const result = await syncWorkspaceDirectory(client, workspaceId);
    return NextResponse.json({ result });
  } catch (err) {
    return errorResponse('Directory sync failed.', 500, err);
  }
}
