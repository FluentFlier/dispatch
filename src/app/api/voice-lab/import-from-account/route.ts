import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { unipoleFetch } from '@/lib/social/unipile';
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

  // account_id = LinkedIn's own provider user ID (used in path).
  // unipile_account_id = Unipile's internal account ID (used as auth query param).
  if (!account.account_id) {
    const label = platform === 'linkedin' ? 'LinkedIn' : 'X';
    return NextResponse.json(
      {
        error: `${label} account missing provider ID. Disconnect and reconnect via Settings.`,
      },
      { status: 404 },
    );
  }

  const providerUserId = account.account_id;
  const unipileAccountId = account.unipile_account_id;

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

    return NextResponse.json({ samples, count: samples.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch posts';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function buildPostUrl(platform: string, postId: string): string {
  if (platform === 'linkedin') {
    return `https://www.linkedin.com/feed/update/${postId}/`;
  }
  return `https://x.com/i/web/status/${postId}`;
}
