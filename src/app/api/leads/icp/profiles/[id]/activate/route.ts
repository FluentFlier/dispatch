import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { activateIcpProfile, listIcpProfiles } from '@/lib/signals/leads/icp-profiles';
import { getDirectorySettings } from '@/lib/signals/leads/store';
import { syncIcpKeywordsToTopics } from '@/lib/signals/leads/topic-sync';
import { errorResponse } from '@/lib/api-errors';

/**
 * POST /api/leads/icp/profiles/[id]/activate
 * Make this ICP active and mirror it into signal_directory_settings so the whole
 * discovery/scoring pipeline uses it. Returns the refreshed list + settings.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  try {
    const client = getServerClient();
    await activateIcpProfile(client, workspaceId, params.id);
    const [profiles, settings] = await Promise.all([
      listIcpProfiles(client, workspaceId),
      getDirectorySettings(client, workspaceId),
    ]);
    // Arm the live signal engine with the newly-active ICP's keywords (additive,
    // capped, non-destructive). Best-effort - activation already succeeded.
    try {
      await syncIcpKeywordsToTopics(client, workspaceId, settings.icp_keywords ?? []);
    } catch {
      /* topic sync is best-effort */
    }
    return NextResponse.json({ profiles, settings });
  } catch (err) {
    return errorResponse('Could not activate ICP.', 500, err);
  }
}
