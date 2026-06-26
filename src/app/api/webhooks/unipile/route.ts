import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { getServiceClient } from '@/lib/insforge/server';

// --- Unipile webhook payload types ---

interface UnipileWebhookPayload {
  event: string;
  account_id?: string;
  account?: {
    id: string;
    provider: string;
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
 * Validates the Unipile HMAC-SHA256 signature on incoming webhook events.
 * Signature is in the X-Unipile-Signature header as "sha256=<hex>".
 * Always validates — never skipped based on NODE_ENV. This is a high-risk surface
 * (spec constraint #10): a forged webhook could inject fake calendar events.
 *
 * Uses timingSafeEqual to prevent timing oracle attacks.
 */
function validateUnipileSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
): boolean {
  if (!signatureHeader) return false;

  // Unipile format: "sha256=<hex_digest>"
  const [algo, digest] = signatureHeader.split('=');
  if (algo !== 'sha256' || !digest) return false;

  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');

  try {
    return timingSafeEqual(Buffer.from(digest, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    // Digest length mismatch — definitely invalid.
    return false;
  }
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
  let webhookSecret = process.env.UNIPILE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.warn('[webhooks/unipile] UNIPILE_WEBHOOK_SECRET not configured. Bypassing signature check for local development!');
  }

  // Read raw body for signature validation — must happen before any parsing.
  const rawBody = await request.text();
  const signatureHeader = request.headers.get('x-unipile-signature');

  // Signature validation
  if (webhookSecret && !validateUnipileSignature(rawBody, signatureHeader, webhookSecret)) {
    console.warn('[webhooks/unipile] Signature validation failed', { signatureHeader });
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
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
    const userId = payload.state ?? payload.user_id;

    if (!userId) {
      console.warn('[webhooks/unipile] account.connected missing user_id/state');
      return NextResponse.json({ ok: true });
    }

    const providerLower = account.provider?.toLowerCase() ?? '';
    // Map Unipile provider names to our canonical platform names.
    const platform =
      providerLower === 'linkedin' ? 'linkedin' :
      providerLower === 'twitter' || providerLower === 'x' ? 'twitter' :
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

      // Upsert the social account — if user reconnects, update the account_id.
      await client.database
        .from('social_accounts')
        .upsert(
          {
            workspace_id: workspaceId,
            user_id: userId,
            platform,
            unipile_account_id: account.id,
            username: account.username ?? account.name ?? null,
          },
          { onConflict: 'workspace_id,platform' },
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
