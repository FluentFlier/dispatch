import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { z } from 'zod';

const PutSchema = z.object({
  preferred_post_length: z.enum(['short', 'standard', 'long']),
});

/**
 * GET: Returns the user's saved content preferences.
 */
export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const client = getServerClient();
  const { data } = await client.database
    .from('user_settings')
    .select('key, value')
    .eq('user_id', user.id)
    .in('key', ['preferred_post_length']);

  const prefs: Record<string, string> = {};
  for (const row of data ?? []) {
    prefs[row.key] = row.value;
  }

  return NextResponse.json({
    preferred_post_length: (prefs['preferred_post_length'] ?? 'standard') as 'short' | 'standard' | 'long',
  });
}

/**
 * PUT: Saves user content preferences (partial update — only provided keys change).
 */
export async function PUT(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const client = getServerClient();
  await client.database
    .from('user_settings')
    .upsert({
      user_id: user.id,
      key: 'preferred_post_length',
      value: parsed.data.preferred_post_length,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,key' });

  return NextResponse.json({ success: true });
}
