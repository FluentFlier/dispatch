import twilio from 'twilio';

/**
 * Twilio SMS/MMS wrapper for the two-way draft flow.
 *
 * WHY a thin wrapper: keeps every Twilio-specific detail (client construction,
 * signature validation, media download auth, TwiML) in one testable place, and
 * lets the rest of the app treat "text the user a draft" and "handle their
 * reply" as plain functions.
 *
 * NOTE on channels: Twilio cannot send Apple iMessage (Apple does not allow it).
 * This uses SMS + MMS, which reach every US phone (green bubbles on iPhone).
 * RCS is an optional later upgrade that falls back to SMS/MMS automatically.
 */

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const MESSAGING_SERVICE_SID = process.env.TWILIO_MESSAGING_SERVICE_SID;
const FROM_NUMBER = process.env.TWILIO_FROM_NUMBER;

/** True when enough Twilio config is present to send messages. */
export function isTwilioConfigured(): boolean {
  return Boolean(ACCOUNT_SID && AUTH_TOKEN && (MESSAGING_SERVICE_SID || FROM_NUMBER));
}

let cachedClient: ReturnType<typeof twilio> | null = null;
function getClient(): ReturnType<typeof twilio> {
  if (!ACCOUNT_SID || !AUTH_TOKEN) {
    throw new Error('Twilio is not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)');
  }
  if (!cachedClient) cachedClient = twilio(ACCOUNT_SID, AUTH_TOKEN);
  return cachedClient;
}

export interface SendMessageInput {
  /** Recipient phone in E.164 (e.g. +15551234567). */
  to: string;
  body: string;
  /** Optional public https media URLs (MMS). */
  mediaUrl?: string[];
}

/**
 * Send an SMS/MMS. Prefers a Messaging Service (holds the A2P-registered sender
 * pool) and falls back to a single from-number. Returns the message SID.
 */
export async function sendMessage(input: SendMessageInput): Promise<string> {
  const client = getClient();
  const base = MESSAGING_SERVICE_SID
    ? { messagingServiceSid: MESSAGING_SERVICE_SID }
    : { from: FROM_NUMBER as string };
  const msg = await client.messages.create({
    ...base,
    to: input.to,
    body: input.body,
    ...(input.mediaUrl && input.mediaUrl.length > 0 ? { mediaUrl: input.mediaUrl } : {}),
  });
  return msg.sid;
}

/**
 * Validate an inbound webhook request actually came from Twilio, using the
 * X-Twilio-Signature header. `url` must be the exact public URL Twilio hit.
 */
export function validateInboundSignature(
  signature: string | null,
  url: string,
  params: Record<string, string>,
): boolean {
  if (!signature || !AUTH_TOKEN) return false;
  return twilio.validateRequest(AUTH_TOKEN, signature, url, params);
}

export interface InboundMessage {
  from: string;
  to: string;
  body: string;
  messageSid: string;
  media: { url: string; contentType: string }[];
}

/**
 * Parse Twilio's form-encoded inbound params into a typed message, pulling any
 * MMS media (NumMedia + MediaUrl{N} + MediaContentType{N}).
 */
export function parseInboundMessage(params: Record<string, string>): InboundMessage {
  const numMedia = parseInt(params.NumMedia ?? '0', 10) || 0;
  const media: { url: string; contentType: string }[] = [];
  for (let i = 0; i < numMedia; i++) {
    const url = params[`MediaUrl${i}`];
    const contentType = params[`MediaContentType${i}`];
    if (url) media.push({ url, contentType: contentType ?? 'application/octet-stream' });
  }
  return {
    from: params.From ?? '',
    to: params.To ?? '',
    body: params.Body ?? '',
    messageSid: params.MessageSid ?? params.SmsSid ?? '',
    media,
  };
}

/**
 * Download an inbound MMS media item. Twilio's media URLs require HTTP Basic
 * Auth (AccountSid:AuthToken). Returns the raw bytes + content type so the
 * caller can re-upload to our own storage (Twilio URLs must not be persisted).
 */
export async function downloadInboundMedia(
  mediaUrl: string,
): Promise<{ buffer: Buffer; contentType: string }> {
  if (!ACCOUNT_SID || !AUTH_TOKEN) {
    throw new Error('Twilio is not configured');
  }
  const auth = Buffer.from(`${ACCOUNT_SID}:${AUTH_TOKEN}`).toString('base64');
  const res = await fetch(mediaUrl, { headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) throw new Error(`Failed to download Twilio media: ${res.status}`);
  const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
  const buffer = Buffer.from(await res.arrayBuffer());
  return { buffer, contentType };
}

/** Build a TwiML reply body. Pass empty string for a silent 200 (no reply). */
export function buildTwimlReply(text: string): string {
  const response = new twilio.twiml.MessagingResponse();
  if (text) response.message(text);
  return response.toString();
}
