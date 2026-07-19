import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient, getServiceClient } from '@/lib/insforge/server';
import { guardAiRequest } from '@/lib/ai-guard';
import { errorResponse } from '@/lib/api-errors';
import { mineNiche } from '@/lib/hooks-intelligence/mining';
import { getBestHooksForGeneration } from '@/lib/hooks-intelligence/resolve-hooks';

/**
 * POST /api/hooks/refresh
 *
 * Manual "refresh hooks" button: re-mine the user's niche (fresh scrape) then
 * return the freshest niche hooks. Mining is budget-capped (HOOKS_MANUAL_MINE_MAX
 * results, ~$0.005 each) and gated by the shared AI daily cap. Scraping always
 * uses the service key, never a tenant LinkedIn session (spec 0.4).
 */
export async function POST(_request: NextRequest): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const guard = await guardAiRequest(user.id);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  if (!process.env.APIFY_TOKEN) {
    return NextResponse.json({ error: 'Fresh hook mining needs the scraper configured (set APIFY_TOKEN).' }, { status: 400 });
  }

  const client = getServerClient();
  const { data: profile } = await client.database
    .from('creator_profile')
    .select('niche_id')
    .eq('user_id', user.id)
    .single();
  const nicheId = (profile as { niche_id?: string | null } | null)?.niche_id ?? null;
  if (!nicheId) {
    return NextResponse.json({ error: 'Add your content pillars first so we can find hooks for your niche.' }, { status: 400 });
  }

  const admin = getServiceClient();
  const { data: nicheRow } = await admin.database
    .from('niches')
    .select('id, label, seed_keywords')
    .eq('id', nicheId)
    .single();
  const niche = nicheRow as { id: string; label: string; seed_keywords: string[] } | null;
  if (!niche) {
    return NextResponse.json({ error: 'Your niche is not set up yet. Try again after generating a post.' }, { status: 400 });
  }

  const maxResults = Math.max(10, Math.min(Number(process.env.HOOKS_MANUAL_MINE_MAX ?? 40) || 40, 100));
  try {
    await mineNiche(admin, niche, { maxResults });
  } catch (err) {
    return errorResponse('Could not mine fresh hooks right now.', 502, err);
  }

  // Return the freshest niche hooks (mined path), same shape as GET /api/hooks/intelligence.
  const resolved = await getBestHooksForGeneration(client, { nicheId, topicText: niche.label, limit: 6 });
  return NextResponse.json({
    hooks: resolved.hooks.map((h, i) => ({
      text: h.text,
      author: String(h.author ?? '').replace(/^@+/, ''),
      score: resolved.explanations[i]?.rlScore ?? 70,
      verticals: h.verticals,
      source: resolved.explanations[i]?.source ?? 'mined',
      reason: resolved.explanations[i]?.reason,
    })),
    count: resolved.hooks.length,
    source: resolved.usedStaticFallback ? 'bootstrap (niche still warming up)' : 'freshly mined',
  });
}
