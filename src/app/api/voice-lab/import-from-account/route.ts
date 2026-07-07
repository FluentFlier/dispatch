import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId, ensureSoloWorkspace } from '@/lib/workspace';
import {
  fetchPostsFromUnipile,
  resolveProviderUserIds,
} from '@/lib/onboarding/import-posts';
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
  const workspaceId = await getActiveWorkspaceId(user.id);

  let query = client.database
    .from('social_accounts')
    .select('unipile_account_id, account_id, account_name')
    .eq('user_id', user.id)
    .eq('platform', platform)
    .not('unipile_account_id', 'is', null);
  if (workspaceId) query = query.eq('workspace_id', workspaceId);

  const { data: account, error: dbError } = await query.maybeSingle();

  if (dbError || !account?.unipile_account_id) {
    const label = platform === 'linkedin' ? 'LinkedIn' : 'X';
    return NextResponse.json(
      { error: `No connected ${label} account found. Connect via Settings to import posts.` },
      { status: 404 },
    );
  }

  const providerUserIds = await resolveProviderUserIds(
    account.unipile_account_id,
    account.account_id,
  );

  if (providerUserIds.length === 0) {
    const label = platform === 'linkedin' ? 'LinkedIn' : 'X';
    return NextResponse.json(
      { error: `${label} account missing provider ID. Disconnect and reconnect via Settings.` },
      { status: 404 },
    );
  }

  try {
    const { samples, rawItems } = await fetchPostsFromUnipile(
      providerUserIds,
      account.unipile_account_id,
      platform,
      25,
    );

    const persistWorkspaceId = workspaceId ?? (await ensureSoloWorkspace(user.id)).id;
    const persisted = await persistImportedPosts({
      client,
      userId: user.id,
      workspaceId: persistWorkspaceId,
      platform,
      items: rawItems.filter((item) => item.id),
    });

    return NextResponse.json({ samples, count: samples.length, persisted });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch posts';
    const status = message.startsWith('Failed to fetch posts') ? 502 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
