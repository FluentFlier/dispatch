import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { runContentIntelligenceSupervisor } from '@/lib/hooks-intelligence/supervisor-agent';
import { usage } from '@/lib/hooks-intelligence/usage-tracker';
import { getAuthenticatedUser } from '@/lib/insforge/server';
import { guardAiRequest } from '@/lib/ai-guard';
import { errorResponse } from '@/lib/api-errors';

const ResearchSchema = z.object({
  brief: z.string().trim().min(1).max(2000),
  vertical: z.string().trim().max(60).optional(),
});

/**
 * Research Agent API (core product feature)
 * POST /api/research { brief: "launch AI tool", vertical: "indie_maker" }
 * Returns: RAG hooks, patterns, suggested content from intelligence.
 * Triggers full closed loop.
 */
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Auth required' }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const parsed = ResearchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.message }, { status: 400 });

  const { brief, vertical } = parsed.data;

  const guard = await guardAiRequest(user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  await usage.track(user.id, 'research', { brief, vertical });

  try {
    const result = await runContentIntelligenceSupervisor(user.id, brief, vertical);
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse('Research is temporarily unavailable.', 500, err);
  }
}
