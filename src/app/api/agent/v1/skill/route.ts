import { NextRequest, NextResponse } from 'next/server';
import { buildAgentSkillMarkdown } from '@/lib/agent-auth/skill-content';

/**
 * GET /api/agent/v1/skill — agent skill markdown (public; no secrets).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin;
  const markdown = buildAgentSkillMarkdown(appUrl);
  return new NextResponse(markdown, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
}
