import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/insforge/server';
import { CURATED_PILLARS, getTrendingPillars } from '@/lib/pillar-catalog';

/**
 * GET /api/pillars/suggestions
 * Returns optional pillar suggestions the user can add to their own set:
 * a curated catalog plus data-driven trending pillars (from Hook Intelligence).
 * The user's voice-generated pillars remain their default; these are additive.
 */
export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  return NextResponse.json({
    curated: CURATED_PILLARS,
    trending: getTrendingPillars(6),
  });
}
