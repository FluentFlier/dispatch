import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { errorResponse } from '@/lib/api-errors';
import { z } from 'zod';
import { ChatMessagesSchema, deriveChatTitle, type ChatMessagePayload } from '@/lib/chats-schema';
import { deriveChatStatus } from '@/lib/chats-status';

const CreateChatSchema = z.object({
  messages: ChatMessagesSchema,
  title: z.string().max(120).optional(),
  platform: z.string().max(30).optional(),
  pillar: z.string().max(60).optional(),
});

/**
 * GET /api/chats - recent Write-chat conversations for the history list
 * (metadata only; message bodies come from GET /api/chats/[id]).
 */
export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();
  try {
    const workspaceId = await getActiveWorkspaceId(user.id);
    // ponytail: pull messages to derive per-session status (running/stalled) in
    // one query. Fine for the 50-chat cap; denormalize a job_status column that
    // the jobs route writes if this jsonb scan ever gets hot.
    let query = client.database
      .from('chat_conversations')
      .select('id, title, platform, pillar, updated_at, messages')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(50);
    if (workspaceId) query = query.eq('workspace_id', workspaceId);

    const { data, error } = await query;
    if (error) throw error;
    const now = Date.now();
    const chats = (data ?? []).map(({ messages, ...summary }) => ({
      ...summary,
      ...deriveChatStatus(Array.isArray(messages) ? (messages as ChatMessagePayload[]) : [], summary.updated_at, now),
    }));
    return NextResponse.json({ chats });
  } catch (err) {
    return errorResponse('Failed to list chats.', 500, err);
  }
}

/**
 * POST /api/chats - create a conversation (first completed exchange).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = CreateChatSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const client = getServerClient();
  try {
    const workspaceId = await getActiveWorkspaceId(user.id);
    const { data, error } = await client.database
      .from('chat_conversations')
      .insert({
        user_id: user.id,
        workspace_id: workspaceId ?? null,
        title: parsed.data.title?.trim() || deriveChatTitle(parsed.data.messages),
        platform: parsed.data.platform ?? null,
        pillar: parsed.data.pillar ?? null,
        messages: parsed.data.messages,
      })
      .select('id, title, updated_at')
      .single();
    if (error) throw error;
    return NextResponse.json({ chat: data }, { status: 201 });
  } catch (err) {
    return errorResponse('Failed to create chat.', 500, err);
  }
}
