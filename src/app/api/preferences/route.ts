import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { z } from 'zod';

// Partial update: any provided key is saved. At least one must be present.
const PutSchema = z.object({
  preferred_post_length: z.enum(['short', 'standard', 'long']).optional(),
  voice_enabled: z.boolean().optional(),
}).refine((v) => v.preferred_post_length !== undefined || v.voice_enabled !== undefined, {
  message: 'No preference fields provided.',
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
    .in('key', ['preferred_post_length', 'voice_enabled']);

  const prefs: Record<string, string> = {};
  for (const row of data ?? []) {
    prefs[row.key] = row.value;
  }

  return NextResponse.json({
    preferred_post_length: (prefs['preferred_post_length'] ?? 'standard') as 'short' | 'standard' | 'long',
    // Default ON - voice is the core value; only disabled when explicitly set to 'false'.
    voice_enabled: prefs['voice_enabled'] !== 'false',
  });
}

/**
 * PUT: Saves user content preferences (partial update - only provided keys change).
 */
export async function PUT(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = PutSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const client = getServerClient();

  // Build one upsert row per provided preference key (user_settings is key/value).
  const rows: { user_id: string; key: string; value: string; updated_at: string }[] = [];
  const now = new Date().toISOString();
  if (parsed.data.preferred_post_length !== undefined) {
    rows.push({ user_id: user.id, key: 'preferred_post_length', value: parsed.data.preferred_post_length, updated_at: now });
  }
  if (parsed.data.voice_enabled !== undefined) {
    rows.push({ user_id: user.id, key: 'voice_enabled', value: String(parsed.data.voice_enabled), updated_at: now });
  }

  const { error } = await client.database
    .from('user_settings')
    .upsert(rows, { onConflict: 'user_id,key' });

  if (error) return NextResponse.json({ error: 'Could not save preferences.' }, { status: 500 });
  return NextResponse.json({ success: true });
}
