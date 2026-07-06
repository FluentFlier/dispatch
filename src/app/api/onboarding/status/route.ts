import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { getSocialProviderMode } from '@/lib/env';
import { isComposioConfigured } from '@/lib/composio/config';
import { isComposioToolkitConnected } from '@/lib/composio/connect';
import { toComposioUserId } from '@/lib/composio/client';
import { getIntegration } from '@/lib/signals/integrations/store';

/**
 * GET /api/onboarding/status
 * Lightweight probe for onboarding UI: Unipile + Gmail connection state.
 */
export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const unipileConfigured = Boolean(
    process.env.UNIPILE_API_KEY?.trim() && process.env.UNIPILE_DSN?.trim(),
  );
  const composioConfigured = isComposioConfigured();

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

  let gmailConnected = false;
  if (composioConfigured && workspaceId) {
    try {
      const integration = await getIntegration(client, workspaceId, 'gmail');
      if (integration?.enabled) {
        gmailConnected = await isComposioToolkitConnected(
          integration.composio_user_id ?? toComposioUserId(workspaceId, user.id),
          'gmail',
        );
      }
    } catch {
      gmailConnected = false;
    }
  }

  const { data: baselineSetting } = await client.database
    .from('user_settings')
    .select('value')
    .eq('user_id', user.id)
    .eq('key', 'onboarding_baseline')
    .maybeSingle();

  const hasBaseline = Boolean(
    typeof baselineSetting?.value === 'string' && baselineSetting.value.trim().length > 2,
  );

  return NextResponse.json({
    unipileConfigured,
    composioConfigured,
    socialProviderMode: getSocialProviderMode(),
    connectedCount: accounts?.length ?? 0,
    platforms: (accounts ?? []).map((a) => a.platform),
    gmailConnected,
    canIngest: (accounts?.length ?? 0) > 0,
    hasBaseline,
    requiresSocialConnect: (accounts?.length ?? 0) === 0,
  });
}
