import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { errorResponse } from '@/lib/api-errors';
import { z } from 'zod';
import { ChatMessagesSchema } from '@/lib/chats-schema';

const UpdateChatSchema = z
  .object({
    messages: ChatMessagesSchema.optional(),
    title: z.string().min(1).max(120).optional(),
    platform: z.string().max(30).optional(),
    pillar: z.string().max(60).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

/** GET /api/chats/[id] - full conversation (messages included) for resume. */
export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();
  try {
    const { data, error } = await client.database
      .from('chat_conversations')
      .select('*')
      .eq('id', params.id)
      .eq('user_id', user.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ chat: data });
  } catch (err) {
    return errorResponse('Failed to load chat.', 500, err);
  }
}

/** PATCH /api/chats/[id] - append/replace messages or rename. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const parsed = UpdateChatSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const client = getServerClient();
  try {
    const { data, error } = await client.database
      .from('chat_conversations')
      .update({ ...parsed.data, updated_at: new Date().toISOString() })
      .eq('id', params.id)
      .eq('user_id', user.id)
      .select('id, title, updated_at')
      .maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ chat: data });
  } catch (err) {
    return errorResponse('Failed to update chat.', 500, err);
  }
}

/** DELETE /api/chats/[id] */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();
  try {
    const { error } = await client.database
      .from('chat_conversations')
      .delete()
      .eq('id', params.id)
      .eq('user_id', user.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse('Failed to delete chat.', 500, err);
  }
}
