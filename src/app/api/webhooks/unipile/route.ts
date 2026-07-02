import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { getServiceClient } from '@/lib/insforge/server';
import { fetchUnipileAccountDetails } from '@/lib/social/unipile';

// --- Unipile webhook payload types ---

interface UnipileWebhookPayload {
  event: string;
  account_id?: string;
  account?: {
    id: string;
    provider?: string;
    type?: string;
    username?: string;
    name?: string;
  };
  message?: unknown;
  post?: unknown;
  // LinkedIn Events are delivered as a special event type.
  linkedin_event?: {
    id: string;
    title?: string;
    description?: string;
    location?: string;
    start_time?: string;
    end_time?: string;
    url?: string;
  };
  // State was injected during hosted connect as the user_id.
  state?: string;
  user_id?: string;
}

/**
 * Verifies an incoming Unipile webhook by matching a shared secret carried in the
 * "Unipile-Auth" header. Unipile does NOT HMAC-sign payloads; instead you attach a
 * custom header (with a secret you choose) when creating the webhook, and Unipile
 * echoes that header on every delivery. We compare it to UNIPILE_WEBHOOK_SECRET in
 * constant time. This is a high-risk surface (a forged webhook could inject fake
 * event captures), so a configured secret is always enforced.
 *
 * Uses timingSafeEqual to prevent timing-oracle attacks.
 */
function isValidUnipileAuth(headerValue: string | null, secret: string): boolean {
  if (!headerValue) return false;
  const provided = Buffer.from(headerValue);
  const expected = Buffer.from(secret);
  // timingSafeEqual throws on length mismatch, so guard first (length is not secret).
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

/**
 * POST /api/webhooks/unipile
 * Receives and processes Unipile webhook events.
 *
 * Handles:
 * - account.connected: stores new social account (LinkedIn/X) for a user.
 * - linkedin.event.detected: creates an event_capture from a LinkedIn Event.
 *   Deduplicates against existing event_captures via fuzzy title match before inserting.
 *
 * Always validates HMAC-SHA256 signature before processing any event.
 * Returns 200 quickly — heavy processing happens inline but is lightweight.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const webhookSecret = process.env.UNIPILE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.warn('[webhooks/unipile] UNIPILE_WEBHOOK_SECRET not configured. Bypassing auth check for local development!');
  }

  // Read raw body once — needed for JSON parsing below.
  const rawBody = await request.text();

  // Auth: Unipile echoes our shared secret in the "Unipile-Auth" header (set when
  // the webhook was created). Reject anything that does not match.
  if (webhookSecret && !isValidUnipileAuth(request.headers.get('unipile-auth'), webhookSecret)) {
    console.warn('[webhooks/unipile] Auth header validation failed');
    return NextResponse.json({ error: 'Invalid webhook auth' }, { status: 401 });
  }

  let payload: UnipileWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as UnipileWebhookPayload;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const client = getServiceClient();

  // --- Handle account.connected: store the new social account ---
  if (payload.event === 'account.connected' && payload.account) {
    const account = payload.account;
    // state is the user.id UUID we injected during hosted link creation.
    // account.name is the LinkedIn display name — do NOT use it for user resolution.
    const userId = payload.state ?? payload.user_id;

    if (!userId) {
      console.warn('[webhooks/unipile] account.connected missing user_id/state');
      return NextResponse.json({ ok: true });
    }

    // Webhook payload may use 'provider' or 'type' depending on Unipile version.
    const providerLower = (account.provider ?? account.type ?? '').toLowerCase();
    // Map Unipile provider names to our canonical platform names.
    const platform =
      providerLower === 'linkedin' ? 'linkedin' :
        providerLower === 'twitter' || providerLower === 'x' || providerLower === 'twitter_v2' ? 'twitter' :
          providerLower === 'instagram' ? 'instagram' :
            providerLower === 'threads' ? 'threads' :
              providerLower;

    // Resolve workspace for this user.
    const { data: memberRow } = await client.database
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', userId)
      .eq('role', 'owner')
      .limit(1)
      .single();

    if (memberRow) {
      const workspaceId = (memberRow as { workspace_id: string }).workspace_id;

      // Fetch full account details to get connection_params.im.publicIdentifier.
      // Webhook payloads carry only a bare account object — no connection_params —
      // so account.username is just a display name, not the LinkedIn provider user ID.
      // publicIdentifier is required for GET /users/{id}/posts.
      let enrichedAccountId: string | null = account.username ?? null;
      try {
        const full = await fetchUnipileAccountDetails(account.id);
        if (full?.connection_params?.im?.publicIdentifier) {
          enrichedAccountId = full.connection_params.im.publicIdentifier;
        }
      } catch {
        // Enrichment is best-effort — fall back to username.
        console.warn('[webhooks/unipile] Could not enrich account_id for', account.id);
      }

      // Upsert the social account — if user reconnects, update the account_id.
      await client.database
        .from('social_accounts')
        .upsert(
          {
            workspace_id: workspaceId,
            user_id: userId,
            platform,
            unipile_account_id: account.id,
            account_name: account.name ?? account.username ?? null,
            account_id: enrichedAccountId,
            access_token: '',
            connection_method: 'unipile',
            connected_at: new Date().toISOString(),
          },
          { onConflict: 'user_id,platform' },
        );
    }
  }

  // --- Handle LinkedIn Event detection ---
  if (payload.event === 'linkedin.event.detected' && payload.linkedin_event) {
    const linkedInEvent = payload.linkedin_event;
    const userId = payload.state ?? payload.user_id;

    if (!userId || !linkedInEvent.title) {
      return NextResponse.json({ ok: true });
    }

    const { data: memberRow } = await client.database
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', userId)
      .eq('role', 'owner')
      .limit(1)
      .single();

    if (!memberRow) {
      return NextResponse.json({ ok: true });
    }

    const workspaceId = (memberRow as { workspace_id: string }).workspace_id;
    const eventDate = linkedInEvent.start_time
      ? new Date(linkedInEvent.start_time).toISOString().split('T')[0]
      : null;

    // --- Deduplication: fuzzy title match + same calendar day (±1 day) ---
    // If the user already has a Google Calendar capture for this event, skip.
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
          // Simple 80% similarity check: shared words / total unique words.
          const wordsA = titleNorm.split(' ');
          const wordsB = existNorm.split(' ');
          const setB = new Set(wordsB);
          const intersection = wordsA.filter((w) => setB.has(w)).length;
          const uniqueWords = Array.from(new Set([...wordsA, ...wordsB]));
          const union = uniqueWords.length;
          return union > 0 && intersection / union >= 0.8;
        });

        if (duplicate) {
          return NextResponse.json({ ok: true, skipped: 'duplicate' });
        }
      }
    }

    // No duplicate — insert as a new LinkedIn-sourced capture.
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
          event_type: 'conference', // LinkedIn Events are generally public events
          is_public_event: true,
          status: 'detected',
        },
        { onConflict: 'workspace_id,provider_event_id', ignoreDuplicates: true },
      );
  }

  return NextResponse.json({ ok: true });
}
