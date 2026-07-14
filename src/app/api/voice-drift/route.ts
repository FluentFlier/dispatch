import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { detectVoiceDrift } from '@/lib/voice-drift';

/**
 * GET /api/voice-drift
 * Compares current voice EMA vs onboarding baseline - suggests re-import when drifted.
 */
export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) {
    return NextResponse.json({ drifted: false, message: 'No workspace' });
  }

  const report = await detectVoiceDrift(client, workspaceId, user.id, 'linkedin');
  return NextResponse.json(report);
}
