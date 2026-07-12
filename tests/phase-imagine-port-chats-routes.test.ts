/**
 * Phase: Imagine port - Write-chat history persistence.
 * /api/chats (list/create) and /api/chats/[id] (get/patch/delete) back the
 * ScriptGenerator history dropdown. Auth-gated, zod-validated, user-scoped.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { deriveChatTitle, ChatMessagesSchema } from '@/lib/chats-schema';

const { getAuthenticatedUser, dbCalls } = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  dbCalls: { inserted: [] as unknown[], updated: [] as unknown[] },
}));

function chainable(result: { data: unknown; error: null }) {
  const builder: Record<string, unknown> = {};
  const self = () => builder;
  for (const m of ['select', 'eq', 'order', 'limit', 'delete']) builder[m] = vi.fn(self);
  builder.insert = vi.fn((row: unknown) => { dbCalls.inserted.push(row); return builder; });
  builder.update = vi.fn((row: unknown) => { dbCalls.updated.push(row); return builder; });
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.maybeSingle = vi.fn(() => Promise.resolve(result));
  builder.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return builder;
}

vi.mock('@/lib/insforge/server', () => ({
  getAuthenticatedUser,
  getServerClient: () => ({
    database: {
      from: () => chainable({ data: { id: 'c1', title: 't', updated_at: 'now', messages: [] }, error: null }),
    },
  }),
}));
vi.mock('@/lib/workspace', () => ({
  getActiveWorkspaceId: vi.fn().mockResolvedValue('w1'),
}));

import { GET as listChats, POST as createChat } from '@/app/api/chats/route';
import { PATCH as patchChat } from '@/app/api/chats/[id]/route';

const MESSAGES = [
  { id: 'm1', role: 'user', content: 'Write about founder burnout' },
  { id: 'm2', role: 'assistant', content: 'Here is a draft...' },
];

function jsonRequest(url: string, method: string, body: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  dbCalls.inserted.length = 0;
  dbCalls.updated.length = 0;
  getAuthenticatedUser.mockResolvedValue({ id: 'u1' });
});

describe('deriveChatTitle', () => {
  it('uses the first user message, collapsed and capped', () => {
    expect(deriveChatTitle(MESSAGES as never)).toBe('Write about founder burnout');
    const long = [{ id: 'm', role: 'user' as const, content: 'x'.repeat(200) }];
    expect(deriveChatTitle(long)).toHaveLength(80);
  });
  it('falls back when there is no user message', () => {
    expect(deriveChatTitle([])).toBe('Untitled chat');
  });
});

describe('ChatMessagesSchema', () => {
  it('rejects unknown roles and oversized histories', () => {
    expect(ChatMessagesSchema.safeParse([{ id: 'm', role: 'system', content: 'x' }]).success).toBe(false);
    const oversized = Array.from({ length: 201 }, (_, i) => ({ id: `m${i}`, role: 'user', content: 'x' }));
    expect(ChatMessagesSchema.safeParse(oversized).success).toBe(false);
    expect(ChatMessagesSchema.safeParse(MESSAGES).success).toBe(true);
  });
});

describe('/api/chats', () => {
  it('401s without a user', async () => {
    getAuthenticatedUser.mockResolvedValue(null);
    expect((await listChats()).status).toBe(401);
    const res = await createChat(jsonRequest('/api/chats', 'POST', { messages: MESSAGES }));
    expect(res.status).toBe(401);
  });

  it('creates a conversation with a derived title and workspace scope', async () => {
    const res = await createChat(jsonRequest('/api/chats', 'POST', { messages: MESSAGES, platform: 'linkedin' }));
    expect(res.status).toBe(201);
    expect(dbCalls.inserted[0]).toMatchObject({
      user_id: 'u1',
      workspace_id: 'w1',
      title: 'Write about founder burnout',
      platform: 'linkedin',
    });
  });

  it('rejects malformed messages', async () => {
    const res = await createChat(jsonRequest('/api/chats', 'POST', { messages: [{ role: 'user' }] }));
    expect(res.status).toBe(400);
  });
});

describe('/api/chats/[id]', () => {
  it('PATCH updates messages and bumps updated_at', async () => {
    const res = await patchChat(jsonRequest('/api/chats/c1', 'PATCH', { messages: MESSAGES }), {
      params: { id: 'c1' },
    });
    expect(res.status).toBe(200);
    expect(dbCalls.updated[0]).toMatchObject({ messages: MESSAGES });
    expect((dbCalls.updated[0] as { updated_at?: string }).updated_at).toBeTruthy();
  });

  it('PATCH rejects an empty update', async () => {
    const res = await patchChat(jsonRequest('/api/chats/c1', 'PATCH', {}), { params: { id: 'c1' } });
    expect(res.status).toBe(400);
  });
});
