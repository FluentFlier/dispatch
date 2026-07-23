import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  getAuthenticatedUser,
  getServerClient,
  getServiceClient,
} from '@/lib/insforge/server';
import { ensureActiveWorkspaceId } from '@/lib/workspace';
import { resolveUnipileTarget, fetchSingleUnipilePost, type OnboardingPlatform } from '@/lib/onboarding/import-posts';
import { persistImportedPosts } from '@/lib/voice-lab/persist-imported-posts';
import { parseLinkedInPostTarget } from '@/lib/engagement/post-url';
import { errorResponse } from '@/lib/api-errors';

const BodySchema = z.object({ url: z.string().min(1).max(500) }).strict();

/** Numeric tweet id from an X/Twitter status URL or a bare id. */
function parseXPostId(input: string): string | null {
  const m = input.trim().match(/status(?:es)?\/(\d{5,25})/i);
  if (m) return m[1];
  if (/^\d{5,25}$/.test(input.trim())) return input.trim();
  return null;
}

/** Which platform a pasted post URL belongs to. */
function platformOfUrl(url: string): OnboardingPlatform {
  return /(?:twitter\.com|x\.com)/i.test(url) ? 'twitter' : 'linkedin';
}

/**
 * POST /api/voice-lab/import-from-url
 * Imports one specific post from a pasted LinkedIn/X URL - the manual
 * counterpart to the account-wide refresh. Resolves the connected account,
 * fetches that single post from Unipile, and persists it like any import.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'A post URL is required.' }, { status: 400 });
  }

  if (!process.env.UNIPILE_API_KEY || !process.env.UNIPILE_DSN) {
    return NextResponse.json({ error: 'Social integration not configured' }, { status: 503 });
  }

  const url = parsed.data.url.trim();
  const platform = platformOfUrl(url);
  const label = platform === 'linkedin' ? 'LinkedIn' : 'X';

  const providerPostId = platform === 'twitter' ? parseXPostId(url) : parseLinkedInPostTarget(url);
  if (!providerPostId) {
    return NextResponse.json(
      { error: `That does not look like a ${label} post URL.` },
      { status: 422 },
    );
  }

  const client = getServerClient();
  const workspaceId = await ensureActiveWorkspaceId(user.id);

  try {
    let accountQuery = client.database
      .from('social_accounts')
      .select('unipile_account_id, account_id')
      .eq('user_id', user.id)
      .eq('platform', platform)
      .not('unipile_account_id', 'is', null);
    if (workspaceId) accountQuery = accountQuery.eq('workspace_id', workspaceId);
    const { data: account } = await accountQuery.maybeSingle();

    if (!account?.unipile_account_id) {
      return NextResponse.json(
        { error: `No connected ${label} account. Connect one in Settings to import posts.` },
        { status: 404 },
      );
    }

    const target = await resolveUnipileTarget(account.unipile_account_id, account.account_id, platform);
    if (!target) {
      return NextResponse.json(
        { error: `Could not reach your ${label} account. Reconnect in Settings.` },
        { status: 404 },
      );
    }

    const item = await fetchSingleUnipilePost(providerPostId, target.unipileAccountId);
    if (!item) {
      return NextResponse.json(
        { error: `Could not find that ${label} post. Check the URL and that it is yours.` },
        { status: 404 },
      );
    }

    const persistClient = process.env.INSFORGE_SERVICE_ROLE_KEY?.trim() ? getServiceClient() : client;
    const persisted = await persistImportedPosts({
      client: persistClient,
      userId: user.id,
      workspaceId,
      platform,
      items: [item],
    });

    return NextResponse.json({ ok: true, persisted });
  } catch (err) {
    return errorResponse('Could not import that post.', 500, err);
  }
}
