import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { decryptToken } from '@/lib/crypto';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { z } from 'zod';
import { TwitterApi } from 'twitter-api-v2';

const RequestSchema = z.object({
  platform: z.enum(['linkedin', 'twitter']),
});

interface VoiceSample {
  content: string;
  platform: string;
  sourceUrl?: string;
}

/**
 * Fetches the user's recent posts from a connected social account and
 * returns them as voice samples for the Voice Lab analyze pipeline.
 * Same return shape as /api/voice-lab/import so the UI treats them identically.
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

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);

  let query = client.database
    .from('social_accounts')
    .select('access_token, account_id, account_name, connection_method')
    .eq('user_id', user.id)
    .eq('platform', platform);
  if (workspaceId) query = query.eq('workspace_id', workspaceId);

  const { data: account, error: dbError } = await query.maybeSingle();

  if (dbError || !account) {
    return NextResponse.json(
      { error: `No connected ${platform === 'linkedin' ? 'LinkedIn' : 'X'} account found` },
      { status: 404 },
    );
  }

  let accessToken: string;
  try {
    accessToken = decryptToken(account.access_token);
  } catch {
    return NextResponse.json(
      { error: 'Could not read stored credentials - try reconnecting your account' },
      { status: 500 },
    );
  }

  try {
    if (platform === 'linkedin') {
      return await fetchLinkedInPosts(accessToken, account.account_id);
    } else {
      return await fetchTwitterPosts(accessToken, account.account_id);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Failed to fetch posts';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function fetchLinkedInPosts(
  accessToken: string,
  accountId: string | null,
): Promise<NextResponse> {
  if (!accountId) {
    return NextResponse.json(
      { error: 'LinkedIn account ID missing - reconnect your account' },
      { status: 400 },
    );
  }

  const authorUrn = `urn:li:person:${accountId}`;
  const url = `https://api.linkedin.com/rest/posts?author=${encodeURIComponent(authorUrn)}&count=20&q=author`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'LinkedIn-Version': '202401',
      'X-Restli-Protocol-Version': '2.0.0',
    },
  });

  if (res.status === 403) {
    return NextResponse.json(
      {
        error:
          'LinkedIn read access not granted. Disconnect and reconnect your LinkedIn account in Settings to enable post import.',
      },
      { status: 403 },
    );
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return NextResponse.json(
      { error: `LinkedIn API error ${res.status}: ${text.slice(0, 200)}` },
      { status: 502 },
    );
  }

  const data = (await res.json()) as {
    elements?: Array<{
      commentary?: string;
      resharedUpdate?: unknown;
      lifecycleState?: string;
      id?: string;
    }>;
  };

  const samples: VoiceSample[] = (data.elements ?? [])
    .filter(
      (el) =>
        el.lifecycleState === 'PUBLISHED' &&
        !el.resharedUpdate &&
        el.commentary &&
        el.commentary.trim().length > 20,
    )
    .map((el) => ({
      content: el.commentary!.trim(),
      platform: 'LinkedIn',
      sourceUrl: el.id ? `https://www.linkedin.com/feed/update/${el.id}/` : undefined,
    }));

  return NextResponse.json({ samples, count: samples.length });
}

async function fetchTwitterPosts(
  accessToken: string,
  accountId: string | null,
): Promise<NextResponse> {
  if (!accountId) {
    return NextResponse.json(
      { error: 'X account ID missing - reconnect your account' },
      { status: 400 },
    );
  }

  const twitterClient = new TwitterApi(accessToken);

  const timeline = await twitterClient.v2.userTimeline(accountId, {
    max_results: 20,
    'tweet.fields': ['text', 'referenced_tweets', 'created_at'],
    exclude: ['retweets', 'replies'],
  });

  const tweets = timeline.data.data ?? [];

  const samples: VoiceSample[] = tweets
    .filter((t) => t.text && t.text.trim().length > 20 && !t.text.startsWith('RT @'))
    .map((t) => ({
      content: t.text.trim(),
      platform: 'Twitter/X',
      sourceUrl: `https://x.com/i/web/status/${t.id}`,
    }));

  return NextResponse.json({ samples, count: samples.length });
}
