import { NextResponse, type NextRequest } from 'next/server';
import { getAuthenticatedUser } from '@/lib/insforge/server';
import { z } from 'zod';

const AutoEditRequestSchema = z.object({
  videoUrl: z.string().url(),
  options: z.object({
    captions: z.boolean().optional(),
    silenceRemoval: z.boolean().optional(),
    smartCuts: z.boolean().optional(),
    template: z.string().optional(),
    format: z.enum(['mp4', 'webm']).optional(),
    quality: z.enum(['720p', '1080p']).optional(),
  }),
});

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

  const parsed = AutoEditRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { videoUrl, options } = parsed.data;
  const jobId = crypto.randomUUID();

  // Caption generation previously synthesized timing data via an LLM. The video
  // pipeline is not built yet, so calling the model just burned provider credits
  // for a stub. The LLM call is removed but the endpoint stays wired: a caption
  // job is still accepted and returns a completed (empty) result. Real caption
  // timing lands when the video pipeline is implemented.
  if (options.captions) {
    return NextResponse.json({
      status: 'completed',
      jobId,
      captions: [],
      message: 'Caption generation is stubbed until the video pipeline is built.',
      videoUrl,
      options,
    });
  }

  // Non-caption processing (silence removal, smart cuts, format conversion) is not
  // yet implemented. Return 501 so the UI shows an honest "coming soon" state
  // instead of faking a job submission that never resolves.
  return NextResponse.json(
    {
      status: 'not_available',
      message:
        'Video processing features (silence removal, smart cuts, format conversion) are not yet available.',
    },
    { status: 501 },
  );
}
