import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { unipoleFetch, fetchUnipileAccountDetails } from '@/lib/social/unipile';
import { buildIdempotencyKey } from '@/lib/publish-queue';
import { z } from 'zod';

const RequestSchema = z.object({
  platform: z.enum(['linkedin', 'twitter']),
});

interface VoiceSample {
  content: string;
  platform: string;
  sourceUrl?: string;
}

/**
 * Fetches the user's recent posts from a connected Unipile social account and
 * returns them as voice samples for the Voice Lab analyze pipeline.
 * Same return shape as /api/voice-lab/import so the UI treats them identically.
 *
 * Requires the account to be connected via Unipile (unipile_account_id present).
 * Users who connected via direct OAuth (legacy) must reconnect through Unipile.
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
      {
        error: `No connected ${label} account found. Connect via Settings to import posts.`,
      },
      { status: 404 },
    );
  }

  const unipileAccountId = account.unipile_account_id;

  // Fetch full account details from Unipile to get the LinkedIn provider member ID.
  // The DB stores publicIdentifier (vanity URL slug like "rudheerreddy") but Unipile's
  // /users/{id}/posts endpoint needs the LinkedIn internal member ID (numeric or ACo... format).
  // We fetch fresh from Unipile each time until we confirm which field holds the right ID.
  let providerUserId: string | null = null;
  try {
    const fullAccount = await fetchUnipileAccountDetails(unipileAccountId);
    const im = fullAccount?.connection_params?.im;

    // Log the full im object so we can see all available fields — remove once confirmed.
    console.log('[import-from-account] Unipile connection_params.im:', JSON.stringify(im ?? {}));

    // Try fields in order of most-likely-to-be LinkedIn member ID.
    // memberId / id may hold the numeric or ACo... encoded member ID.
    providerUserId =
      im?.memberId ??
      im?.id ??
      im?.objectUrn ??
      im?.publicIdentifier ??
      account.account_id ??
      null;

    console.log('[import-from-account] resolved providerUserId:', providerUserId);
  } catch {
    // Fall back to stored account_id if enrichment fails.
    providerUserId = account.account_id ?? null;
  }

  if (!providerUserId) {
    const label = platform === 'linkedin' ? 'LinkedIn' : 'X';
    return NextResponse.json(
      { error: `${label} account missing provider ID. Disconnect and reconnect via Settings.` },
      { status: 404 },
    );
  }

  try {
    const res = await unipoleFetch(
      `/users/${encodeURIComponent(providerUserId)}/posts?account_id=${encodeURIComponent(unipileAccountId)}&limit=25`,
      { method: 'GET' },
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return NextResponse.json(
        { error: `Failed to fetch posts (${res.status}): ${errText.slice(0, 200)}` },
        { status: 502 },
      );
    }

    const json = (await res.json()) as {
      items?: Array<{
        id?: string;
        text?: string;
        commentary?: string;
        provider?: string;
        is_repost?: boolean;
        is_reply?: boolean;
      }>;
    };

    const platformLabel = platform === 'linkedin' ? 'LinkedIn' : 'Twitter/X';

    const samples: VoiceSample[] = (json.items ?? [])
      .filter(
        (item) =>
          !item.is_repost &&
          !item.is_reply &&
          (item.text ?? item.commentary ?? '').trim().length > 20,
      )
      .map((item) => {
        const content = (item.text ?? item.commentary ?? '').trim();
        return {
          content,
          platform: platformLabel,
          sourceUrl: item.id ? buildPostUrl(platform, item.id) : undefined,
        };
      });

    // Fire-and-forget: persist imported posts + publish_jobs so engagement-sync
    // can fetch LinkedIn comments for posts published outside the app.
    void persistImportedPosts({
      client,
      userId: user.id,
      workspaceId: workspaceId ?? null,
      platform,
      items: (json.items ?? []).filter(
        (item) =>
          item.id &&
          !item.is_repost &&
          !item.is_reply &&
          (item.text ?? item.commentary ?? '').trim().length > 20,
      ),
    }).catch((err) => {
      console.warn('[import-from-account] background post persist failed:', err);
    });

    return NextResponse.json({ samples, count: samples.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch posts';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

interface UnipileItem {
  id?: string;
  text?: string;
  commentary?: string;
  provider?: string;
  is_repost?: boolean;
  is_reply?: boolean;
}

/**
 * Persists Unipile-imported posts + publish_jobs rows so the engagement-sync
 * cron can call Unipile GET /posts/{social_id}/comments for each one.
 * Skips any post already tracked (idempotent by idempotency_key).
 */
async function persistImportedPosts({
  client,
  userId,
  workspaceId,
  platform,
  items,
}: {
  client: ReturnType<typeof getServerClient>;
  userId: string;
  workspaceId: string | null;
  platform: string;
  items: UnipileItem[];
}): Promise<void> {
  for (const item of items) {
    if (!item.id) continue;
    const content = (item.text ?? item.commentary ?? '').trim();
    const idempotencyKey = buildIdempotencyKey(userId, item.id, platform, null);

    // Skip if already tracked
    const { data: existing } = await client.database
      .from('publish_jobs')
      .select('id')
      .eq('idempotency_key', idempotencyKey)
      .limit(1);

    if (existing?.[0]) continue;

    // Create a posts row for this historically-published post
    const postId = randomUUID();
    const { error: postErr } = await client.database.from('posts').insert([{
      id: postId,
      user_id: userId,
      workspace_id: workspaceId,
      title: content.slice(0, 80),
      script: content,
      platform,
      status: 'posted',
      posted_date: new Date().toISOString().split('T')[0],
    }]);

    if (postErr) {
      console.warn('[import-from-account] post insert failed:', postErr.message);
      continue;
    }

    // Create the publish_job row with provider_post_id so comments sync works
    const { error: jobErr } = await client.database.from('publish_jobs').insert([{
      user_id: userId,
      post_id: postId,
      platform,
      status: 'published',
      provider: 'unipile',
      provider_post_id: item.id,
      provider_url: buildPostUrl(platform, item.id),
      idempotency_key: idempotencyKey,
      attempts: 1,
      max_attempts: 3,
      scheduled_for: null,
      last_error: null,
    }]);

    if (jobErr) {
      console.warn('[import-from-account] publish_job insert failed:', jobErr.message);
    }
  }
}

function buildPostUrl(platform: string, postId: string): string {
  if (platform === 'linkedin') {
    return `https://www.linkedin.com/feed/update/${postId}/`;
  }
  return `https://x.com/i/web/status/${postId}`;
}
