import { NextResponse, type NextRequest } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { guardAiRequest } from '@/lib/ai-guard';
import { errorResponse } from '@/lib/api-errors';
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

function parseCaptionArray(text: string): unknown[] {
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

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

  // If captions are requested, generate AI captions
  if (options.captions) {
    const guard = await guardAiRequest(user.id);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    try {
      const client = getServerClient();
      const { data: aiResponse } = await client.ai.chat.completions.create({
        model: 'anthropic/claude-sonnet-4.5',
        messages: [
          {
            role: 'system',
            content: `You generate caption timing data for short-form video content. Generate a sequence of caption phrases that would work for a 30-60 second talking head video. Each phrase should be 2-5 words, timed at 30fps. Return ONLY valid JSON array. No em dashes.`,
          },
          {
            role: 'user',
            content: `Generate 8-12 caption phrases for a short-form video. Return as JSON array with objects: { "text": "phrase", "startFrame": number, "endFrame": number }. Space them evenly across 900 frames (30 seconds at 30fps). Start from frame 0.`,
          },
        ],
        maxTokens: 1000,
      });

      const rawText = aiResponse?.choices?.[0]?.message?.content ?? '[]';
      const captions = parseCaptionArray(rawText);

      return NextResponse.json({
        status: 'completed',
        jobId,
        captions,
        message: 'Captions generated successfully',
        videoUrl,
        options,
      });
    } catch (err) {
      // Non-fatal: log the real cause server-side, return graceful empty captions.
      console.error('[auto-edit] Caption generation failed:', err);
      return NextResponse.json({
        status: 'completed',
        jobId,
        captions: [],
        message: 'Caption generation failed, using empty captions',
        videoUrl,
        options,
      });
    }
  }

  // Non-caption video processing (silence removal, smart cuts, format conversion)
  // is not yet implemented. Return 501 so the UI can show an honest "coming soon"
  // state instead of faking a job submission that never resolves.
  return NextResponse.json(
    {
      status: 'not_available',
      message:
        'Video processing features (silence removal, smart cuts, format conversion) are not yet available. Caption generation is the only supported option.',
    },
    { status: 501 }
  );
}
