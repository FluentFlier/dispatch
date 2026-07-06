import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getBrainPage, putBrainPage } from '@/lib/brain/pages';
import { BRAIN_SLUG } from '@/lib/brain/types';

const SaveSchema = z.object({
  content: z.string().trim().min(1).max(2000),
  type: z.string().trim().max(40).optional(),
  source: z.string().trim().max(80).optional(),
});

/**
 * Append a single reference (e.g. a high-converting hook) to the creator's
 * long-term memory. Accumulates into one "saved-references" brain page so it
 * informs future AI drafts. Distinct from /api/brain/sync (full profile resync).
 */
export async function POST(req: Request): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = SaveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const { content, type, source } = parsed.data;
  const client = getServerClient();

  try {
    const existing = await getBrainPage(client, user.id, BRAIN_SLUG.savedReferences);
    const entry = `- ${content}${source ? ` (${source})` : ''}`;
    const nextBody = existing?.body
      ? `${existing.body}\n${entry}`
      : `Saved references and hooks worth reusing.\n\n${entry}`;

    await putBrainPage(client, user.id, {
      slug: BRAIN_SLUG.savedReferences,
      title: 'Saved references',
      tags: ['saved', type ?? 'reference'],
      body: nextBody,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Brain save error:', err);
    return NextResponse.json({ error: 'Could not save to Creator Brain' }, { status: 500 });
  }
}
