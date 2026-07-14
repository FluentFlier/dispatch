import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getAppUrl } from '@/lib/env';
import { isTwilioConfigured, sendMessage } from '@/lib/sms/twilio';
import { signDraftToken } from '@/lib/sms/draft-token';
import { logError } from '@/lib/logger';

const BodySchema = z.object({ postId: z.string().uuid() });

/**
 * Text the authenticated user a magic link to review/edit one of their drafts.
 * WHY: mirrors Stanley's "draft to your phone" capture - the user gets an SMS,
 * can reply with edits + a photo (handled by the inbound webhook), then open
 * the link to post. The link carries a signed, self-expiring token so no login
 * is needed on the phone.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  if (!isTwilioConfigured()) {
    return NextResponse.json(
      { error: 'SMS is not configured on this deployment.' },
      { status: 503 },
    );
  }

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const client = getServerClient();

  // The user's verified phone. Degrades cleanly if the phone_numbers table has
  // not been provisioned yet (db/sms-drafts.sql).
  let phone: string | null = null;
  try {
    const { data } = await client.database
      .from('phone_numbers')
      .select('phone, verified')
      .eq('user_id', user.id)
      .eq('verified', true)
      .maybeSingle();
    phone = data?.phone ?? null;
  } catch (e) {
    logError('[sms/send-draft] phone_numbers lookup failed (table missing?)', undefined, e);
    return NextResponse.json({ error: 'No verified phone on file.' }, { status: 400 });
  }
  if (!phone) {
    return NextResponse.json({ error: 'No verified phone on file.' }, { status: 400 });
  }

  // Load a short preview for the SMS body.
  const { data: post } = await client.database
    .from('posts')
    .select('title, script, caption')
    .eq('id', parsed.data.postId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!post) return NextResponse.json({ error: 'Draft not found.' }, { status: 404 });

  const token = signDraftToken({ postId: parsed.data.postId, userId: user.id });
  const link = `${getAppUrl().replace(/\/$/, '')}/d/${token}`;
  const preview = (post.title || post.script || post.caption || 'your draft').toString().slice(0, 80);

  try {
    const sid = await sendMessage({
      to: phone,
      body: `Your draft is ready: "${preview}"\nReply to edit (add a photo if you want), or open: ${link}`,
    });
    return NextResponse.json({ sent: true, sid });
  } catch (e) {
    logError('[sms/send-draft] send failed', { postId: parsed.data.postId }, e);
    return NextResponse.json({ error: 'Failed to send SMS.' }, { status: 502 });
  }
}
