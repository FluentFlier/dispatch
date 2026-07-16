import { z } from 'zod';

/**
 * Write-chat conversation persistence contracts, shared by /api/chats and
 * /api/chats/[id]. Messages mirror ScriptGenerator's ChatMessage shape.
 * Bounds keep a single conversation row at a sane size: 200 messages of at
 * most 20k chars each.
 */
export const ChatMessageSchema = z.object({
  id: z.string().max(64),
  role: z.enum(['user', 'assistant']),
  content: z.string().max(20_000),
  voiceMetrics: z
    .object({
      used_hook_ids: z.array(z.string().max(64)).max(20).optional(),
      ai_score: z.number().optional(),
      voice_match_score: z.number().nullable().optional(),
    })
    .optional(),
  completeness: z
    .object({
      starved: z.boolean().optional(),
      voiceSource: z.string().optional(),
    })
    .nullable()
    .optional(),
  status: z.enum(['queued', 'running', 'done', 'error', 'canceled']).optional(),
  stage: z.enum(['thinking', 'writing', 'revising', 'polishing', 'scoring']).nullable().optional(),
  error: z.string().max(500).optional(),
  contextId: z.string().uuid().nullable().optional(),
});

export const ChatMessagesSchema = z.array(ChatMessageSchema).max(200);

export type ChatMessagePayload = z.infer<typeof ChatMessageSchema>;

/** First user message, trimmed, as the conversation title. */
export function deriveChatTitle(messages: ChatMessagePayload[]): string {
  const first = messages.find((m) => m.role === 'user' && m.content.trim());
  if (!first) return 'Untitled chat';
  const line = first.content.trim().replace(/\s+/g, ' ');
  return line.length > 80 ? `${line.slice(0, 77)}...` : line;
}
