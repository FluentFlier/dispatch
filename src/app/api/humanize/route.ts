import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { humanize, aiScore } from '@/lib/humanizer';
import { loadCreatorVoiceContext } from '@/lib/voice-context';
import { z } from 'zod';
import { checkRateLimit } from '@/lib/rate-limit';

const HumanizeSchema = z.object({
  text: z.string().min(1).max(25000),
  scoreOnly: z.boolean().optional(),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rl = await checkRateLimit(user.id);
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
  }

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = HumanizeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  if (parsed.data.scoreOnly) {
    try {
      const result = await aiScore(parsed.data.text);
      return NextResponse.json(result);
    } catch (err) {
      console.error('AI score error:', err);
      return NextResponse.json({ error: 'Scoring failed' }, { status: 500 });
    }
  }

  const client = getServerClient();
  const { profile } = await loadCreatorVoiceContext(client, user.id);

  try {
    const humanized = await humanize(parsed.data.text, profile);
    return NextResponse.json({ text: humanized });
  } catch (err) {
    console.error('Humanize error:', err);
    return NextResponse.json({ error: 'Humanization failed' }, { status: 500 });
  }
}
