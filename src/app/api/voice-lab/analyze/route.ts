import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/insforge/server';
import { guardAiRequest } from '@/lib/ai-guard';
import { errorResponse } from '@/lib/api-errors';
import { analyzeVoiceSamples } from '@/lib/voice-lab/analyze-samples';
import { z } from 'zod';

const AnalyzeSchema = z.object({
  samples: z.array(z.object({
    content: z.string().min(1).max(5000),
    platform: z.string().optional(),
  })).min(1).max(20),
});

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const parsed = AnalyzeSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const guard = await guardAiRequest(user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  try {
    const analysis = await analyzeVoiceSamples(parsed.data.samples);
    return NextResponse.json(analysis);
  } catch (err) {
    return errorResponse('Analysis failed.', 500, err);
  }
}
