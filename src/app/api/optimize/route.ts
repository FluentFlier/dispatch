import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { loadCreatorVoiceContext } from '@/lib/voice-context';
import { guardAiRequest } from '@/lib/ai-guard';
import { generateOptimizeVariants, type OptimizePlatform } from '@/lib/optimize-variants';
import { z } from 'zod';

const PLATFORM_ENUM = z.enum(['twitter', 'linkedin', 'instagram', 'threads']);

const OptimizeSchema = z.object({
  content: z.string().min(1, 'Content is required').max(25000),
  sourcePlatform: PLATFORM_ENUM,
  targetPlatforms: z.array(PLATFORM_ENUM).min(1, 'At least one target platform is required'),
  postId: z.string().uuid().optional(),
  optimizationLevel: z.enum(['light', 'full']).default('full'),
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
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = OptimizeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const { content, targetPlatforms, optimizationLevel } = parsed.data;

  const guard = await guardAiRequest(user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);
  const { profile, contextAdditions } = await loadCreatorVoiceContext(client, user.id, {
    memoryQuery: content.slice(0, 200),
    workspaceId: workspaceId ?? undefined,
  });

  const { variants, errors } = await generateOptimizeVariants({
    content,
    targetPlatforms: targetPlatforms as OptimizePlatform[],
    optimizationLevel,
    profile,
    contextAdditions,
  });

  if (variants.length === 0 && errors.length > 0) {
    return NextResponse.json(
      { error: 'All platform optimizations failed', details: errors },
      { status: 500 },
    );
  }

  return NextResponse.json({
    variants,
    ...(errors.length > 0 ? { errors } : {}),
  });
}
