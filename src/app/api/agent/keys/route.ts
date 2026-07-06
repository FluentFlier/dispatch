import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/insforge/server';
import { createAgentKey, listAgentKeys } from '@/lib/agent-auth/store';
import { z } from 'zod';

const CreateSchema = z.object({
  name: z.string().min(1).max(80),
  scopes: z.array(z.enum(['read', 'write', 'publish', 'outreach'])).optional(),
});

/**
 * GET /api/agent/keys — list active agent API keys (session auth only).
 * POST /api/agent/keys — create a new key; raw secret returned once.
 */
export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const keys = await listAgentKeys(user.id);
    return NextResponse.json({ keys });
  } catch (err) {
    console.error('[agent/keys] list failed:', err);
    return NextResponse.json({ error: 'Failed to list agent keys' }, { status: 500 });
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  try {
    const created = await createAgentKey(user.id, parsed.data.name, parsed.data.scopes);
    return NextResponse.json(
      {
        key: {
          id: created.id,
          name: created.name,
          key_prefix: created.key_prefix,
          scopes: created.scopes,
          created_at: created.created_at,
        },
        api_key: created.api_key,
        message: 'Copy the api_key now — it will not be shown again.',
      },
      { status: 201 },
    );
  } catch (err) {
    console.error('[agent/keys] create failed:', err);
    return NextResponse.json({ error: 'Failed to create agent key' }, { status: 500 });
  }
}
