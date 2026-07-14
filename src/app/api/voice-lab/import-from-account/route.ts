import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient, getServiceClient } from '@/lib/insforge/server';
import {
  backfillNullWorkspaceSocialAccounts,
  ensureActiveWorkspaceId,
} from '@/lib/workspace';
import {
  fetchPostsFromUnipile,
  resolveUnipileTarget,
} from '@/lib/onboarding/import-posts';
import {
  syncUnipileAccountsForUser,
  UnipileAccountsSyncError,
} from '@/lib/social/sync-unipile-accounts';
import { persistImportedPosts } from '@/lib/voice-lab/persist-imported-posts';
import { z } from 'zod';

const RequestSchema = z.object({
  platform: z.enum(['linkedin', 'twitter']),
});

/**
 * Fetches the user's recent posts from a connected Unipile social account and
 * returns them as voice samples for the Voice Lab analyze pipeline.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const { platform } = parsed.data;

  if (!process.env.UNIPILE_API_KEY || !process.env.UNIPILE_DSN) {
    return NextResponse.json(
      { error: 'Social integration not configured' },
      { status: 503 },
    );
  }

  const client = getServerClient();
  // Match /api/social-accounts: import is often the first action after connect
  // or login, so repair accounts written before workspace provisioning before
  // we decide LinkedIn is missing.
  const workspaceId = await ensureActiveWorkspaceId(user.id);
  await backfillNullWorkspaceSocialAccounts(user.id, workspaceId);

  const findConnectedAccount = async () => {
    let query = client.database
      .from('social_accounts')
      .select('unipile_account_id, account_id, account_name')
      .eq('user_id', user.id)
      .eq('platform', platform)
      .not('unipile_account_id', 'is', null);
    if (workspaceId) query = query.eq('workspace_id', workspaceId);

    return query.maybeSingle();
  };

  let { data: account, error: dbError } = await findConnectedAccount();

  if (!dbError && !account?.unipile_account_id) {
    try {
      await syncUnipileAccountsForUser(user.id);
      ({ data: account, error: dbError } = await findConnectedAccount());
    } catch (err: unknown) {
      if (err instanceof UnipileAccountsSyncError) {
        return NextResponse.json(
          { error: `Could not refresh your connected accounts. ${err.message}` },
          { status: err.status },
        );
      }
      console.error('[voice-lab/import-from-account] Account refresh failed:', err);
    }
  }

  if (dbError || !account?.unipile_account_id) {
    const label = platform === 'linkedin' ? 'LinkedIn' : 'X';
    return NextResponse.json(
      { error: `No connected ${label} account found. Connect via Settings to import posts.` },
      { status: 404 },
    );
  }

  // Self-heals a rotated unipile_account_id (Unipile re-issues it on LinkedIn
  // credential re-auth) by re-matching on the stable publicIdentifier - avoids
  // spurious "reconnect" prompts on a still-valid connection.
  const target = await resolveUnipileTarget(
    account.unipile_account_id,
    account.account_id,
    platform,
  );

  if (!target || target.providerUserIds.length === 0) {
    const label = platform === 'linkedin' ? 'LinkedIn' : 'X';
    return NextResponse.json(
      { error: `${label} account missing provider ID. Disconnect and reconnect via Settings.` },
      { status: 404 },
    );
  }

  // Persist the recovered id so subsequent reads don't repeat the lookup.
  if (target.refreshed) {
    let update = client.database
      .from('social_accounts')
      .update({ unipile_account_id: target.unipileAccountId })
      .eq('user_id', user.id)
      .eq('platform', platform);
    if (workspaceId) update = update.eq('workspace_id', workspaceId);
    await update;
  }

  try {
    const { samples, rawItems, fetchedCount, filteredCount } = await fetchPostsFromUnipile(
      target.providerUserIds,
      target.unipileAccountId,
      platform,
      25,
    );

    const persistClient = process.env.INSFORGE_SERVICE_ROLE_KEY?.trim()
      ? getServiceClient()
      : client;
    const persisted = await persistImportedPosts({
      client: persistClient,
      userId: user.id,
      workspaceId,
      platform,
      items: rawItems.filter((item) => item.id),
    });

    // Seed the imported posts as voice samples so connecting + importing an
    // account actually completes the voice profile. Without this the "voice
    // profile incomplete" banner stayed lit forever after a LinkedIn connect:
    // completeness reads user_settings.sample_posts / voice_source, which the
    // post persistence above never touched (voice-context `starved` check).
    if (samples.length > 0) {
      // Best-effort: a seeding failure must never fail the import itself.
      try {
        const voiceSamples = samples
          .slice(0, 20)
          .map((s) => ({ content: s.content, platform: s.platform }));
        for (const setting of [
          { key: 'sample_posts', value: JSON.stringify(voiceSamples) },
          { key: 'voice_source', value: 'imported' },
        ]) {
          await client.database
            .from('user_settings')
            .upsert(
              {
                user_id: user.id,
                // Match onboarding/ingest: voice-context reads user_settings with
                // a workspace_id filter when a workspace is active, so a null-
                // workspace row would be invisible and leave the banner lit.
                workspace_id: workspaceId,
                key: setting.key,
                value: setting.value,
                updated_at: new Date().toISOString(),
              },
              { onConflict: 'user_id,key' },
            );
        }
      } catch (seedErr) {
        console.warn('[voice-lab/import-from-account] voice-sample seed failed (non-critical):', seedErr);
      }
    }

    return NextResponse.json({
      samples,
      count: samples.length,
      fetchedCount,
      filteredCount,
      persisted,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch posts';
    const status = message.startsWith('Failed to fetch posts') ? 502 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
