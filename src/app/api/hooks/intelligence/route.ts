import { NextRequest, NextResponse } from 'next/server';
import { getBestHooksForContext, getTopHooksTool, searchHooksTool } from '@/lib/hooks-intelligence';
import { getAuthenticatedUser } from '@/lib/insforge/server';

/**
 * Hook Intelligence API
 * 
 * Primary way the app + future agents consume the mined + ranked hook data.
 * 
 * GET /api/hooks/intelligence?vertical=indie_maker&limit=8
 * GET /api/hooks/intelligence/search?q=how I made
 * 
 * This powers amazing post generation and can be called directly by agents.
 */
export async function GET(request: NextRequest) {
  const user = await getAuthenticatedUser();
  if (!user) {
    // Still allow public read for now (research data is not sensitive)
  }

  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'top';
  const vertical = searchParams.get('vertical') as any;
  const limit = parseInt(searchParams.get('limit') || '8');
  const q = searchParams.get('q') || '';

  try {
    if (action === 'search' && q) {
      const results = searchHooksTool({ query: q, vertical, limit });
      return NextResponse.json(results);
    }

    const hooks = getBestHooksForContext(vertical, limit);
    return NextResponse.json({
      hooks: hooks.map(h => ({
        text: h.text,
        author: h.author,
        score: h.score.total,
        verticals: h.verticals,
      })),
      count: hooks.length,
      source: "gstack-mined + ranked Hook Intelligence",
    });
  } catch (e) {
    return NextResponse.json({ error: 'Hook intelligence temporarily unavailable' }, { status: 503 });
  }
}
