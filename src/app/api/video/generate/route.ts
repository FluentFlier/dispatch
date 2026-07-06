import { NextResponse, type NextRequest } from 'next/server';
import { getAuthenticatedUser } from '@/lib/insforge/server';
import { z } from 'zod';

const GenerateVideoSchema = z.object({
  prompt: z.string().min(1).max(2000),
  template: z.enum([
    'talking-head-captions',
    'hook-content',
    'story-highlights',
    'stats-overlay',
    'before-after',
  ]),
  duration: z.number().min(5).max(120).optional(),
}).strict();

export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = GenerateVideoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { template, duration = 30 } = parsed.data;
  const fps = 30;
  const totalFrames = duration * fps;

  // Composition generation previously called an LLM to synthesize caption / hook /
  // stat timing per template. The video pipeline is not built yet, so the model
  // call was removed to avoid spending provider credits on a stub. The endpoint
  // still returns the composition scaffolding (template + frame math) so the editor
  // can wire up manual clip selection; model-generated timing arrives when the
  // video pipeline lands.
  return NextResponse.json({
    compositionData: {},
    template,
    totalFrames,
    fps,
    message: `Template "${template}" is ready for manual clip selection. Automatic composition generation arrives when the video pipeline is built.`,
  });
}
