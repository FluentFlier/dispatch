import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { getSocialProviderMode } from '@/lib/env';

/**
 * GET /api/onboarding/status
 * Lightweight probe for onboarding UI: Unipile configured + connected account count.
 */
export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const unipileConfigured = Boolean(
    process.env.UNIPILE_API_KEY?.trim() && process.env.UNIPILE_DSN?.trim(),
  );

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);

  let query = client.database
    .from('social_accounts')
    .select('platform, unipile_account_id')
    .eq('user_id', user.id)
    .in('platform', ['linkedin', 'twitter'])
    .not('unipile_account_id', 'is', null);

  if (workspaceId) query = query.eq('workspace_id', workspaceId);

  const { data: accounts } = await query;

  return NextResponse.json({
    unipileConfigured,
    socialProviderMode: getSocialProviderMode(),
    connectedCount: accounts?.length ?? 0,
    platforms: (accounts ?? []).map((a) => a.platform),
  });
}
