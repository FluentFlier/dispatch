import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { getSocialProviderMode } from '@/lib/env';
import { isComposioConfigured } from '@/lib/composio/config';
import { isComposioToolkitConnected } from '@/lib/composio/connect';
import { toComposioUserId } from '@/lib/composio/client';
import { getIntegration } from '@/lib/signals/integrations/store';
import type { CreatorBaseline } from '@/lib/onboarding/baseline';

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

  let baseline: CreatorBaseline | null = null;
  if (typeof baselineSetting?.value === 'string' && baselineSetting.value.trim().length > 2) {
    try {
      const parsed: unknown = JSON.parse(baselineSetting.value);
      // Shape-check, not just JSON-valid: a corrupt row (e.g. `12345` or `{"foo":1}`) would
      // otherwise parse fine and pass a non-baseline object to the wizard, which crashes
      // calling .join()/.map() on missing array fields during resume hydration.
      baseline =
        parsed && typeof parsed === 'object'
        && Array.isArray((parsed as CreatorBaseline).voiceRules)
        && Array.isArray((parsed as CreatorBaseline).pillars)
          ? (parsed as CreatorBaseline)
          : null;
    } catch {
      // Malformed stored value: treat as no baseline rather than failing the route.
      baseline = null;
    }
  }

  return NextResponse.json({
    unipileConfigured,
    composioConfigured,
    socialProviderMode: getSocialProviderMode(),
    connectedCount: accounts?.length ?? 0,
    platforms: (accounts ?? []).map((a) => a.platform),
    gmailConnected,
    canIngest: (accounts?.length ?? 0) > 0,
    hasBaseline: Boolean(baseline),
    baseline,
    requiresSocialConnect: (accounts?.length ?? 0) === 0,
  });
}
