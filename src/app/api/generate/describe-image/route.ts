import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { describeImage } from '@/lib/llm';
import { isOwnedImageKey } from '@/lib/image-context';
import { guardAiRequest } from '@/lib/ai-guard';

const BodySchema = z.object({ key: z.string().min(3).max(500) });

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success || !isOwnedImageKey(parsed.data.key, user.id)) {
    return NextResponse.json({ error: 'Image must be uploaded through Content OS.' }, { status: 400 });
  }
  const guard = await guardAiRequest(user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const publicUrl = getServerClient().storage.from('post-media').getPublicUrl(parsed.data.key);
  const url = typeof publicUrl === 'string'
    ? publicUrl
    : (publicUrl as { data?: { publicUrl?: string } })?.data?.publicUrl;
  if (!url) return NextResponse.json({ error: 'Could not resolve uploaded image.' }, { status: 500 });
  const description = await describeImage(url);
  return NextResponse.json({
    description: description ?? 'An image is attached. Consider its visual context when drafting the post.',
  });
}
