import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { followLeadOnLinkedIn } from '@/lib/signals/outreach/follow-lead';
import { errorResponse } from '@/lib/api-errors';

/**
 * POST /api/leads/:id/follow
 * Follow the lead's primary contact on LinkedIn. Runs through the full safety
 * guard (dry-run, working hours, cooldown, daily follow cap), the profile-lookup
 * cap, per-account daily budget, and a random 10–35s pause between the profile
 * resolve and the follow so the two Unipile calls are not chained instantly.
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
    const result = await followLeadOnLinkedIn(client, {
      workspaceId,
      userId: user.id,
      leadId: params.id,
    });

    if (!result.success) {
      const status = result.retryAfterSeconds ? 429 : 422;
      return NextResponse.json(
        { error: result.error ?? 'Follow blocked.', retryAfterSeconds: result.retryAfterSeconds },
        { status },
      );
    }

    return NextResponse.json({ lead: result.lead });
  } catch (err) {
    return errorResponse('Could not follow lead.', 500, err);
  }
}
