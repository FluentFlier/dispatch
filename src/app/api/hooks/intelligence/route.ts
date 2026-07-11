import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getBestHooksForGeneration } from '@/lib/hooks-intelligence/resolve-hooks';
import { searchHooksTool } from '@/lib/hooks-intelligence';
import type { HookVertical } from '@/lib/hooks-intelligence/types';

/**
 * Hook Intelligence API — DB-learned scores + mined hooks + static fallback.
 *
 * GET /api/hooks/intelligence?vertical=indie_maker&limit=8
 * GET /api/hooks/intelligence?action=search&q=how I made
 *
 * Requires an authenticated session (was previously public).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'top';
  const vertical = searchParams.get('vertical') as HookVertical | null;
  const limit = parseInt(searchParams.get('limit') || '8', 10);
  const q = searchParams.get('q') || '';

  try {
    if (action === 'search' && q) {
      const results = searchHooksTool({ query: q, vertical: vertical ?? undefined, limit });
      return NextResponse.json(results);
    }

    let client;
    try {
      client = getServerClient();
    } catch {
      client = undefined;
    }

    const resolved = await getBestHooksForGeneration(client, vertical ?? undefined, limit);

    return NextResponse.json({
      hooks: resolved.hooks.map((h, i) => ({
        text: h.text,
        author: String(h.author ?? '').replace(/^@+/, ''),
        score: resolved.explanations[i]?.rlScore ?? 70,
        verticals: h.verticals,
        source: resolved.explanations[i]?.source ?? 'static',
        reason: resolved.explanations[i]?.reason,
      })),
      count: resolved.hooks.length,
      source: 'db-learned + mined + bootstrap',
    });
  } catch {
    return NextResponse.json({ error: 'Hook intelligence temporarily unavailable' }, { status: 503 });
  }
}
