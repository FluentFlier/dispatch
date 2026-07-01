import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/lib/insforge/server';
import {
  validateInboundSignature,
  parseInboundMessage,
  downloadInboundMedia,
  buildTwimlReply,
} from '@/lib/sms/twilio';
import { logError, logInfo } from '@/lib/logger';

const BUCKET = 'post-media';

/** TwiML content type for webhook replies. */
function twiml(body: string): NextResponse {
  return new NextResponse(body, { status: 200, headers: { 'Content-Type': 'text/xml' } });
}

/**
 * Twilio inbound SMS/MMS webhook.
 *
 * Flow: the user replies to a draft SMS with edits and/or a photo. We verify the
 * request is really from Twilio, map the sender's phone to a user, attach any
 * photo to their most recent draft, and record the reply text. Mirrors the
 * "reply with a picture, the post auto-updates" experience.
 *
 * Applying the reply text as a full content rewrite is intentionally left as a
 * follow-up — we append it to the draft notes (non-destructive) so nothing the
 * user typed is lost.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // Twilio posts application/x-www-form-urlencoded.
  let params: Record<string, string> = {};
  try {
    const form = await request.formData();
    for (const [k, v] of Array.from(form.entries())) params[k] = typeof v === 'string' ? v : '';
  } catch {
    return twiml(buildTwimlReply(''));
  }

  // Validate the signature against the exact public URL Twilio was configured
  // with (request.url can be an internal address behind a proxy).
  const url = process.env.TWILIO_INBOUND_WEBHOOK_URL ?? request.url;
  const signature = request.headers.get('x-twilio-signature');
  if (!validateInboundSignature(signature, url, params)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 });
  }

  const msg = parseInboundMessage(params);
  if (!msg.from) return twiml(buildTwimlReply(''));

  const client = getServerClient();

  // Map the sender's phone to a verified user.
  let userId: string | null = null;
  try {
    const { data } = await client.database
      .from('phone_numbers')
      .select('user_id')
      .eq('phone', msg.from)
      .eq('verified', true)
      .maybeSingle();
    userId = data?.user_id ?? null;
  } catch (e) {
    logError('[twilio/inbound] phone lookup failed (table missing?)', undefined, e);
  }
  if (!userId) {
    // Unknown sender — acknowledge without leaking whether the number is known.
    return twiml(buildTwimlReply('We could not match this number to an account.'));
  }

  // Target the user's most recent unpublished draft.
  const { data: draft } = await client.database
    .from('posts')
    .select('id, notes')
    .eq('user_id', userId)
    .neq('status', 'posted')
    .order('updated_at', { ascending: false })
    .maybeSingle();
  if (!draft) {
    return twiml(buildTwimlReply('No open draft to update. Create one in the app first.'));
  }

  const patch: Record<string, string> = {};

  // Attach the first image, if any: download from Twilio (Basic Auth) and
  // re-upload to our own storage — Twilio media URLs must not be persisted.
  const image = msg.media.find((m) => m.contentType.startsWith('image/'));
  if (image) {
    try {
      const { buffer, contentType } = await downloadInboundMedia(image.url);
      const ext = contentType.split('/')[1]?.split(';')[0] || 'jpg';
      const fileName = `${userId}/sms-${Date.now()}.${ext}`;
      const blob = new Blob([new Uint8Array(buffer)], { type: contentType });
      const { data, error } = await client.storage.from(BUCKET).upload(fileName, blob);
      if (error) throw new Error(error.message);
      const key = data?.key ?? fileName;
      const publicUrl = client.storage.from(BUCKET).getPublicUrl(key);
      patch.image_url = typeof publicUrl === 'string'
        ? publicUrl
        : (publicUrl as { data?: { publicUrl?: string } })?.data?.publicUrl ?? '';
    } catch (e) {
      logError('[twilio/inbound] media handling failed', { draftId: draft.id }, e);
    }
  }

  // Record the reply text non-destructively.
  if (msg.body.trim()) {
    const prior = (draft.notes as string | null) ?? '';
    patch.notes = prior ? `${prior}\n\n[SMS reply] ${msg.body.trim()}` : `[SMS reply] ${msg.body.trim()}`;
  }

  if (Object.keys(patch).length > 0) {
    const { error } = await client.database.from('posts').update(patch).eq('id', draft.id);
    if (error) {
      logError('[twilio/inbound] draft update failed', { draftId: draft.id }, error);
      return twiml(buildTwimlReply('Something went wrong updating your draft.'));
    }
  }

  logInfo('[twilio/inbound] processed', { userId, draftId: draft.id, hadImage: Boolean(image) });
  const confirm = image ? 'Photo added to your draft. Open the link to post.' : 'Draft updated. Open the link to post.';
  return twiml(buildTwimlReply(confirm));
}
