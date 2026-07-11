import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { listIcpProfiles } from '@/lib/signals/leads/icp-profiles';
import { updateDirectorySettings } from '@/lib/signals/leads/store';
import { syncWorkspaceDirectory } from '@/lib/signals/ingest/sync-directory';
import { errorResponse } from '@/lib/api-errors';
import type { IcpProfileRow } from '@/lib/signals/types';

const bodySchema = z.object({
  profileIds: z.array(z.string()).min(1),
});

/** Copies a profile's ICP fields into directory settings for one discovery pass. */
function mirror(profile: IcpProfileRow) {
  return {
    icp_description: profile.description,
    icp_verticals: profile.verticals,
    icp_keywords: profile.keywords,
  };
}

/**
 * POST /api/leads/icp/discover
 * Runs the directory discovery pipeline once per selected ICP (mirroring each
 * into settings so scrape/scoring uses its terms), then restores the active
 * profile's mirror. Reuses syncWorkspaceDirectory so results flow into the feed
 * unchanged.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Select at least one ICP to discover leads.' }, { status: 400 });
  }

  try {
    const client = getServerClient();
    const profiles = await listIcpProfiles(client, workspaceId);
    const selected = profiles.filter((p) => parsed.data.profileIds.includes(p.id));
    if (selected.length === 0) {
      return NextResponse.json({ error: 'None of the selected ICPs exist.' }, { status: 400 });
    }
    const active = profiles.find((p) => p.is_active) ?? null;

    let inserted = 0;
    try {
      for (const profile of selected) {
        await updateDirectorySettings(client, workspaceId, mirror(profile));
        const result = await syncWorkspaceDirectory(client, workspaceId);
        inserted += result.inserted;
      }
    } finally {
      // Restore the active profile's ICP so settings reflect it again, whatever
      // the last profile discovered against was (best-effort — never throws).
      if (active) {
        await updateDirectorySettings(client, workspaceId, mirror(active)).catch(() => {});
      }
    }

    return NextResponse.json({ inserted, icpCount: selected.length });
  } catch (err) {
    return errorResponse('Discovery failed.', 500, err);
  }
}
