import { NextRequest, NextResponse } from 'next/server';
import { runContentIntelligenceSupervisor } from '@/lib/hooks-intelligence/supervisor-agent';
import { usage } from '@/lib/hooks-intelligence/usage-tracker';
import { getAuthenticatedUser } from '@/lib/insforge/server';

/**
 * Research Agent API (core product feature)
 * POST /api/research { brief: "launch AI tool", vertical: "indie_maker" }
 * Returns: RAG hooks, patterns, suggested content from intelligence.
 * Triggers full closed loop.
 */
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Auth required' }, { status: 401 });

  const { brief, vertical } = await req.json();
  await usage.track(user.id, 'research', { brief, vertical });

  const result = await runContentIntelligenceSupervisor(user.id, brief, vertical);
  return NextResponse.json(result);
}
