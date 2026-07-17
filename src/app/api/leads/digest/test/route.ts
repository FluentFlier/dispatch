import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { runWorkspaceDigest } from '@/lib/signals/leads/digest';
import { errorResponse } from '@/lib/api-errors';

// The digest assembles leads + calls Composio Gmail/Slack; keep the node runtime.
export const runtime = 'nodejs';

/**
 * POST /api/leads/digest/test
 * Runs the workspace digest immediately in force/test mode: bypasses the
 * schedule gate, skips the scrape, and does NOT stamp delivery (so it never
 * suppresses the real morning digest). Returns per-channel outcomes so the user
 * can see exactly why email/Slack did or didn't send - the on-demand way to
 * verify delivery without waiting for the hourly cron or a deploy.
 */
export async function POST(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  try {
    const client = getServerClient();
    const result = await runWorkspaceDigest(client, workspaceId, new Date(), { force: true });
    return NextResponse.json({ result });
  } catch (err) {
    return errorResponse('Could not run test digest.', 500, err);
  }
}
