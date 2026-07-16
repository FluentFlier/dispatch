import type { ChatMessagePayload } from '@/lib/chats-schema';

/**
 * Write-session status shown in the sidebar, derived from the conversation's
 * last assistant message plus how fresh updated_at is.
 *
 * `stalled` covers a job that exceeded the 300s function maxDuration (or died):
 * the last message stays 'running' in the DB forever, so the client would poll
 * it indefinitely. Freshness turns that into a terminal-ish state instead.
 */
export type ChatStatus = 'running' | 'idle' | 'stalled';
export type ChatStage = NonNullable<ChatMessagePayload['stage']>;

export interface ChatSummary {
  id: string;
  title: string;
  platform?: string | null;
  updated_at: string;
  status: ChatStatus;
  stage?: ChatStage | null;
}

/** A running job that hasn't touched the row in this long is treated as stalled. */
export const CHAT_STALE_MS = 6 * 60 * 1000;

export function deriveChatStatus(
  messages: Pick<ChatMessagePayload, 'role' | 'status' | 'stage'>[],
  updatedAt: string,
  now: number,
): { status: ChatStatus; stage: ChatStage | null } {
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const running = lastAssistant?.status === 'queued' || lastAssistant?.status === 'running';
  if (!running) return { status: 'idle', stage: null };
  if (now - new Date(updatedAt).getTime() > CHAT_STALE_MS) return { status: 'stalled', stage: null };
  return { status: 'running', stage: lastAssistant?.stage ?? null };
}
