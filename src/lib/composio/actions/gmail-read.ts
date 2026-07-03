import { executeComposioTool } from '@/lib/composio/execute';

interface GmailMessageRow {
  messageId?: string;
  message_id?: string;
  id?: string;
  subject?: string;
  snippet?: string;
  body?: string;
  messageText?: string;
  message_text?: string;
  preview?: { body?: string; subject?: string };
  payload?: {
    body?: { data?: string };
    parts?: Array<{ mimeType?: string; body?: { data?: string } }>;
  };
}

export interface GmailVoiceMessage {
  subject: string;
  body: string;
}

const SENT_LABEL = 'SENT';
const DEFAULT_MAX = 40;

/**
 * Strips HTML, quoted replies, and signature noise so email bodies are usable as voice samples.
 */
export function cleanEmailBodyForVoice(raw: string): string {
  let text = raw
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

  const lines = text.split('\n');
  const cleaned: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('>')) continue;
    if (/^on .+ wrote:$/i.test(trimmed)) break;
    if (/^-{2,}\s*original message\s*-{2,}$/i.test(trimmed)) break;
    if (/^from:/i.test(trimmed) && cleaned.length > 3) break;
    cleaned.push(trimmed);
  }

  const joined = cleaned.join('\n').replace(/\s+/g, ' ').trim();

  return joined
    .replace(/\s*from:\s*[^\s]+@[^\s]+.*$/i, '')
    .replace(/\s*on .+ wrote:.*$/i, '')
    .trim();
}

function decodeBase64Url(data: string): string {
  try {
    const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
    const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
    return Buffer.from(normalized + pad, 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function extractBodyFromPayload(payload: GmailMessageRow['payload']): string {
  if (!payload) return '';
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  for (const part of payload.parts ?? []) {
    const mime = part.mimeType ?? '';
    if (mime.includes('text/plain') && part.body?.data) {
      return decodeBase64Url(part.body.data);
    }
  }
  for (const part of payload.parts ?? []) {
    if (part.mimeType?.includes('text/html') && part.body?.data) {
      return decodeBase64Url(part.body.data);
    }
  }
  return '';
}

function extractMessageBody(row: GmailMessageRow): string {
  const candidates = [
    row.body,
    row.messageText,
    row.message_text,
    row.preview?.body,
    row.snippet,
    extractBodyFromPayload(row.payload),
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) {
      return cleanEmailBodyForVoice(c);
    }
  }
  return '';
}

function extractMessages(data: unknown): GmailMessageRow[] {
  const d = (data ?? {}) as Record<string, unknown>;
  const candidates: unknown[] = [
    d.messages,
    (d.data as { messages?: unknown })?.messages,
    (d.response_data as { messages?: unknown })?.messages,
  ];
  const arr = candidates.find(Array.isArray);
  return (arr as GmailMessageRow[] | undefined) ?? [];
}

/**
 * Fetches sent Gmail messages for voice analysis via Composio.
 * Uses verbose=false per Composio reliability guidance; hydrates body when present.
 */
export async function fetchSentEmailsForVoice(
  composioUserId: string,
  maxResults = DEFAULT_MAX,
): Promise<GmailVoiceMessage[]> {
  const result = await executeComposioTool<Record<string, unknown>>(
    composioUserId,
    'GMAIL_FETCH_EMAILS',
    {
      label_ids: [SENT_LABEL],
      max_results: maxResults,
      verbose: false,
      include_payload: true,
    },
  );

  if (!result.success) {
    console.warn('[gmail-read] fetch failed:', result.error);
    return [];
  }

  const rows = extractMessages(result.data);
  const out: GmailVoiceMessage[] = [];

  for (const row of rows) {
    const body = extractMessageBody(row);
    if (body.length < 40) continue;
    const subject = (row.subject ?? row.preview?.subject ?? '').trim();
    out.push({ subject, body });
    if (out.length >= maxResults) break;
  }

  return out;
}
