import { NextRequest, NextResponse } from 'next/server';
import { getServiceClient } from '@/lib/insforge/server';
import { fetchUnipileAccountDetails, mapPlatform, pruneDuplicateUnipileAccounts } from '@/lib/social/unipile';
import { isValidUnipileAuth, validateUnipileWebhookAuth } from '@/lib/webhooks/unipile-auth';
import { isSnapshotExpired } from '@/lib/social/connect-snapshot';
import { ensureSoloWorkspace } from '@/lib/workspace';
import { handleInboundUnipileMessage } from '@/lib/signals/leads/inbound-message';

interface UnipileWebhookPayload {
  event?: string;
  status?: 'CREATION_SUCCESS' | 'RECONNECTED' | 'CREATION_FAIL' | string;
  name?: string;
  account_id?: string;
  account_type?: string;
  AccountStatus?: {
    account_id?: string;
    account_type?: string;
    message?: string;
  };
  account?: {
    id: string;
    provider?: string;
    type?: string;
    username?: string;
    name?: string;
  };
  message?: unknown;
  post?: unknown;
  linkedin_event?: {
    id: string;
    title?: string;
    description?: string;
    location?: string;
    start_time?: string;
    end_time?: string;
    url?: string;
  };
  state?: string;
  user_id?: string;
}

type ServiceClient = ReturnType<typeof getServiceClient>;

function getHostedCallbackSecret() {
  return process.env.UNIPILE_HOSTED_CALLBACK_SECRET
    ?? process.env.UNIPILE_WEBHOOK_SECRET
    ?? process.env.CRON_SECRET;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * First candidate that is actually shaped like a user id. Binding writes to a
 * `user_id` column, so a value that cannot be one (a display name, an empty
 * string, a provider placeholder) must never reach it - refusing is always
 * safer than binding a stranger's LinkedIn to a malformed id.
 */
function firstUuid(...candidates: Array<string | undefined | null>): string | null {
  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (value && UUID_RE.test(value)) return value;
  }
  return null;
}

function isHostedAuthCallback(payload: UnipileWebhookPayload) {
  return Boolean(
    payload.account_id &&
    payload.name &&
    (payload.status === 'CREATION_SUCCESS' || payload.status === 'RECONNECTED'),
  );
}

async function upsertSocialAccountFromUnipileAccount({
  client,
  userId,
  unipileAccountId,
  fallbackAccount,
}: {
  client: ServiceClient;
  userId: string;
  unipileAccountId: string;
  fallbackAccount?: UnipileWebhookPayload['account'];
}) {
  let workspaceId: string | null = null;
  try {
    workspaceId = (await ensureSoloWorkspace(userId)).id;
  } catch (err) {
    console.warn(
      '[webhooks/unipile] Could not resolve workspace for',
      userId,
      err instanceof Error ? err.message : err,
    );
  }
  if (!workspaceId) return;

  const full = await fetchUnipileAccountDetails(unipileAccountId);
  const provider = full?.provider ?? full?.type ?? fallbackAccount?.provider ?? fallbackAccount?.type ?? '';
  const platform = mapPlatform(provider);
  if (!platform) {
    console.warn('[webhooks/unipile] Unsupported account provider:', provider || '(missing)');
    return;
  }

  const accountId =
    full?.connection_params?.im?.publicIdentifier ??
    full?.connection_params?.im?.memberId ??
    full?.connection_params?.im?.id ??
    full?.username ??
    fallbackAccount?.username ??
    null;
  const accountName =
    full?.name ??
    full?.connection_params?.im?.username ??
    fallbackAccount?.name ??
    fallbackAccount?.username ??
    null;

  // Ownership guard - the shared Unipile subscription's webhooks carry accounts
  // this user may not own, and periodic RECONNECTED events would otherwise
  // re-bind a stranger every few minutes. Require positive proof before binding:
  //   (a) the account isn't already owned by a different user (rotating id OR
  //       stable public identifier), and
  //   (b) it appeared AFTER this user's pre-connect snapshot - i.e. THIS user's
  //       connect produced it. Snapshot absent → no proof of ownership → refuse.
  const { data: others } = await client.database
    .from('social_accounts')
    .select('user_id, unipile_account_id, account_id')
    .neq('user_id', userId);
  const claimedByOther = (others ?? []).some(
    (r: { unipile_account_id?: string | null; account_id?: string | null }) =>
      r.unipile_account_id === unipileAccountId || (accountId != null && r.account_id === accountId),
  );
  if (claimedByOther) {
    console.warn('[webhooks/unipile] refusing bind - account already owned by another user', {
      userId,
      unipileAccountId,
      accountId,
    });
    return;
  }

  const { data: snap } = await client.database
    .from('unipile_connect_snapshots')
    .select('account_ids, created_at')
    .eq('user_id', userId)
    .maybeSingle();
  if (!snap) {
    console.warn('[webhooks/unipile] refusing bind - no pending connect snapshot for user', {
      userId,
      unipileAccountId,
    });
    return;
  }
  // A snapshot is a time-boxed permit, not a standing permission. It is only
  // deleted on a successful bind, so a user who clicked Connect and abandoned
  // the LinkedIn login used to leave a permit that never expired - any account
  // appearing in the shared tenant days later would bind to them with no
  // authentication at all. Tie its lifetime to the hosted link's.
  if (isSnapshotExpired((snap as { created_at?: string }).created_at)) {
    console.warn('[webhooks/unipile] refusing bind — connect snapshot expired', {
      userId,
      unipileAccountId,
      createdAt: (snap as { created_at?: string }).created_at,
    });
    await client.database.from('unipile_connect_snapshots').delete().eq('user_id', userId);
    return;
  }
  const snapshotIds = new Set(
    ((snap as { account_ids?: string[] }).account_ids ?? []).filter(Boolean),
  );
  if (snapshotIds.has(unipileAccountId)) {
    console.warn('[webhooks/unipile] refusing bind - account pre-existed the user connect (not theirs)', {
      userId,
      unipileAccountId,
    });
    return;
  }

  await client.database
    .from('social_accounts')
    .upsert(
      {
        workspace_id: workspaceId,
        user_id: userId,
        platform,
        unipile_account_id: unipileAccountId,
        account_name: accountName,
        account_id: accountId,
        access_token: '',
        connection_method: 'unipile',
        connected_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,platform' },
    );

  // One connect → one bind. Clearing the snapshot means a later RECONNECTED /
  // duplicate event for the same connect can't silently re-bind (no proof left).
  await client.database
    .from('unipile_connect_snapshots')
    .delete()
    .eq('user_id', userId);

  // Reap this person's stale duplicate boxes (dev + prod share one Unipile key,
  // so every reconnect anywhere piles up another session on the same tenant).
  await pruneDuplicateUnipileAccounts(
    unipileAccountId,
    full?.connection_params?.im?.publicIdentifier ?? null,
  );
}

/**
 * POST /api/webhooks/unipile
 *
 * Handles both Unipile callback families:
 * - Hosted-auth notify_url callbacks: { status, account_id, name }
 * - API-managed webhooks: signed with unipile-signature over the raw body
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const rawBody = await request.text();

  let payload: UnipileWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as UnipileWebhookPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const hostedCallback = isHostedAuthCallback(payload);
  if (hostedCallback) {
    const callbackSecret = getHostedCallbackSecret();
    const token = request.nextUrl.searchParams.get('token');
    const production = process.env.NODE_ENV === 'production';

    if (!callbackSecret?.trim()) {
      if (production) {
        return NextResponse.json(
          { error: 'A hosted callback secret is required in production' },
          { status: 503 },
        );
      }
      console.warn('[webhooks/unipile] Hosted callback token missing in local development.');
    } else if (!isValidUnipileAuth(token, callbackSecret)) {
      console.warn('[webhooks/unipile] Hosted callback token validation failed');
      return NextResponse.json({ error: 'Invalid callback token' }, { status: 401 });
    }
  } else {
    const auth = validateUnipileWebhookAuth(
      process.env.UNIPILE_WEBHOOK_SECRET,
      request.headers.get('unipile-signature'),
      rawBody,
    );
    if (!auth.ok) {
      if (auth.status === 401) {
        console.warn('[webhooks/unipile] Signature validation failed');
      }
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
  }

  const client = getServiceClient();

  if (hostedCallback) {
    // Identify the user from `state` first: the connect route sets BOTH `name`
    // and `state` to the user id, but `name` is documented as a display label,
    // so anything that ever changes it (a relabel in the Unipile dashboard, a
    // provider default, a hand-made test event) would send this bind to a
    // wrong-but-plausible id. `state` is the field that exists to carry it.
    // Whichever we use must look like a user id: a non-uuid means the payload
    // is not one of our hosted links, so refuse rather than bind on garbage.
    const claimedUserId = firstUuid(payload.state, payload.name);
    if (!claimedUserId) {
      console.warn('[webhooks/unipile] hosted callback carried no valid user id', {
        state: payload.state ?? null,
        name: payload.name ?? null,
      });
      return NextResponse.json({ ok: true });
    }
    await upsertSocialAccountFromUnipileAccount({
      client,
      userId: claimedUserId,
      unipileAccountId: payload.account_id as string,
    });
    return NextResponse.json({ ok: true });
  }

  if (payload.AccountStatus?.account_id) {
    const accountId = payload.AccountStatus.account_id;
    const status = payload.AccountStatus.message?.toLowerCase();

    // Only a genuine credential loss forces the user to reconnect. Unipile also
    // emits transient `error`/`stopped` on temporary sync pauses (rate limits,
    // brief LinkedIn hiccups) while the session is still authenticated - nulling
    // connected_at on those made accounts look disconnected and nagged users to
    // reconnect a live session every few days. Leave transient states alone.
    if (status === 'credentials' || status === 'deleted') {
      await client.database
        .from('social_accounts')
        .update({ connected_at: null })
        .eq('unipile_account_id', accountId);
    } else if (status === 'ok' || status === 'sync_success' || status === 'reconnected') {
      await client.database
        .from('social_accounts')
        .update({ connected_at: new Date().toISOString() })
        .eq('unipile_account_id', accountId);
    }

    return NextResponse.json({ ok: true });
  }

  if (payload.event === 'account.connected' && payload.account) {
    const userId = payload.state ?? payload.user_id;
    if (!userId) {
      console.warn('[webhooks/unipile] account.connected missing user_id/state');
      return NextResponse.json({ ok: true });
    }

    await upsertSocialAccountFromUnipileAccount({
      client,
      userId,
      unipileAccountId: payload.account.id,
      fallbackAccount: payload.account,
    });
  }

  if (payload.event === 'linkedin.event.detected' && payload.linkedin_event) {
    const linkedInEvent = payload.linkedin_event;
    const userId = payload.state ?? payload.user_id;

    if (!userId || !linkedInEvent.title) {
      return NextResponse.json({ ok: true });
    }

    let workspaceId: string;
    try {
      workspaceId = (await ensureSoloWorkspace(userId)).id;
    } catch (err) {
      console.warn(
        '[webhooks/unipile] Could not resolve workspace for event',
        userId,
        err instanceof Error ? err.message : err,
      );
      return NextResponse.json({ ok: true });
    }

    const eventDate = linkedInEvent.start_time
      ? new Date(linkedInEvent.start_time).toISOString().split('T')[0]
      : null;

    if (eventDate) {
      const dayBefore = new Date(new Date(eventDate).getTime() - 24 * 60 * 60 * 1000).toISOString();
      const dayAfter = new Date(new Date(eventDate).getTime() + 24 * 60 * 60 * 1000).toISOString();

      const { data: existing } = await client.database
        .from('event_captures')
        .select('id, title')
        .eq('workspace_id', workspaceId)
        .gte('start_time', dayBefore)
        .lte('start_time', dayAfter);

      if (existing && existing.length > 0) {
        const titleNorm = linkedInEvent.title.toLowerCase().replace(/[^a-z0-9 ]/g, '');
        const duplicate = (existing as { id: string; title: string }[]).some((e) => {
          const existNorm = e.title.toLowerCase().replace(/[^a-z0-9 ]/g, '');
          const wordsA = titleNorm.split(' ');
          const wordsB = existNorm.split(' ');
          const setB = new Set(wordsB);
          const intersection = wordsA.filter((word) => setB.has(word)).length;
          const uniqueWords = Array.from(new Set([...wordsA, ...wordsB]));
          const union = uniqueWords.length;
          return union > 0 && intersection / union >= 0.8;
        });

        if (duplicate) {
          return NextResponse.json({ ok: true, skipped: 'duplicate' });
        }
      }
    }

    await client.database
      .from('event_captures')
      .upsert(
        {
          workspace_id: workspaceId,
          user_id: userId,
          source: 'linkedin',
          provider_event_id: linkedInEvent.id,
          title: linkedInEvent.title,
          description: linkedInEvent.description ?? null,
          location: linkedInEvent.location ?? null,
          start_time: linkedInEvent.start_time ?? new Date().toISOString(),
          end_time: linkedInEvent.end_time ?? new Date().toISOString(),
          event_type: 'conference',
          is_public_event: true,
          status: 'detected',
        },
        { onConflict: 'workspace_id,provider_event_id', ignoreDuplicates: true },
      );
  }

  const inbound = await handleInboundUnipileMessage(client, payload as Record<string, unknown>);
  if (inbound.handled && inbound.leadId) {
    return NextResponse.json({ ok: true, leadId: inbound.leadId });
  }
  if (inbound.handled) {
    return NextResponse.json({ ok: true, skipped: inbound.skipped ?? true });
  }

  return NextResponse.json({ ok: true });
}
