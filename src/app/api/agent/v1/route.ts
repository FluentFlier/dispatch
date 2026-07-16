import { NextRequest, NextResponse } from 'next/server';
import { resolveAgentAuth } from '@/lib/agent-auth/context';
import { PRODUCT_NAME } from '@/lib/brand';

const ENDPOINTS = [
  { method: 'GET', path: '/api/agent/v1/session', scope: 'read', description: 'Bootstrap user, workspace, platforms' },
  { method: 'GET', path: '/api/agent/v1/skill', scope: 'read', description: 'Agent skill instructions (markdown)' },
  { method: 'POST', path: '/api/agent/v1/generate', scope: 'write', description: 'Generate content in creator voice' },
  { method: 'GET', path: '/api/agent/v1/posts', scope: 'read', description: 'List posts in library' },
  { method: 'POST', path: '/api/agent/v1/posts', scope: 'write', description: 'Create a draft post' },
  { method: 'POST', path: '/api/agent/v1/publish', scope: 'publish', description: 'Publish or schedule a post' },
  { method: 'GET', path: '/api/agent/v1/engagement/inbox', scope: 'read', description: 'Comment inbox' },
  { method: 'POST', path: '/api/agent/v1/engagement/sync', scope: 'read', description: 'Sync comments from platforms' },
  { method: 'POST', path: '/api/agent/v1/engagement/draft-replies', scope: 'write', description: 'AI draft comment replies' },
  { method: 'GET', path: '/api/agent/v1/signals', scope: 'read', description: 'List signal events' },
  { method: 'GET', path: '/api/agent/v1/warm-contacts', scope: 'read', description: 'ICP engagers from your post reactions' },
  { method: 'POST', path: '/api/agent/v1/warm-contacts', scope: 'read', description: 'Sync warm contacts from post reactions' },
  { method: 'POST', path: '/api/agent/v1/warm-contacts/{id}/draft', scope: 'outreach', description: 'Draft LinkedIn connect note' },
  { method: 'POST', path: '/api/agent/v1/warm-contacts/{id}/send', scope: 'outreach', description: 'Send LinkedIn connect invite' },
] as const;

/**
 * GET /api/agent/v1 - capability discovery for agents.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const auth = await resolveAgentAuth(request);
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin;

  return NextResponse.json({
    name: `${PRODUCT_NAME} Agent API`,
    version: 1,
    auth: 'Authorization: Bearer cos_live_...',
    docs: `${appUrl}/api/agent/v1/skill`,
    scopes: auth.scopes,
    endpoints: ENDPOINTS,
  });
}
