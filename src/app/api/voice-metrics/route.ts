import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';

// --- Row shape returned by workspace_voice_metrics ---
interface VoiceMetricsRow {
  platform: string;
  avg_voice_match_score: number | string;
  avg_ai_score: number | string;
  avg_persona_fidelity: number | string;
  avg_uniqueness: number | string;
  avg_specificity: number | string;
  avg_so_what: number | string;
  avg_pain_resonance: number | string;
  post_count: number | string;
}

// --- Public shape returned to callers ---
interface PlatformMetrics {
  avg_voice_match_score: number;
  avg_ai_score: number;
  post_count: number;
  breakdown: {
    persona_fidelity: number;
    uniqueness: number;
    specificity: number;
    so_what: number;
    pain_resonance: number;
  };
}

/**
 * GET /api/voice-metrics
 *
 * Returns aggregated voice quality metrics for the authenticated user's active
 * workspace, keyed by platform. Used by the Voice Lab UI panel and generation
 * context injection (Layer 4).
 *
 * Returns an empty `{ platforms: {} }` object when no data exists yet —
 * never returns 404 so the UI can render a "no data yet" state without error
 * handling.
 *
 * Auth: session cookie via getAuthenticatedUser(). Requires an active workspace.
 */
export async function GET(): Promise<NextResponse> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = getServerClient();
  const workspaceId = await getActiveWorkspaceId(user.id);

  // No workspace yet — nothing to show, return empty safely
  if (!workspaceId) {
    return NextResponse.json({ platforms: {} });
  }

  const { data: rows, error } = await client.database
    .from('workspace_voice_metrics')
    .select('*')
    .eq('workspace_id', workspaceId);

  if (error) {
    console.error('[voice-metrics] DB query failed:', error.message);
    return NextResponse.json({ error: 'Failed to fetch metrics' }, { status: 500 });
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json({ platforms: {} });
  }

  // --- Build per-platform map from DB rows ---
  const platforms: Record<string, PlatformMetrics> = {};

  for (const raw of rows as VoiceMetricsRow[]) {
    platforms[raw.platform] = {
      avg_voice_match_score: Number(raw.avg_voice_match_score),
      avg_ai_score: Number(raw.avg_ai_score),
      post_count: Number(raw.post_count),
      breakdown: {
        persona_fidelity: Number(raw.avg_persona_fidelity),
        uniqueness: Number(raw.avg_uniqueness),
        specificity: Number(raw.avg_specificity),
        so_what: Number(raw.avg_so_what),
        pain_resonance: Number(raw.avg_pain_resonance),
      },
    };
  }

  return NextResponse.json({ platforms });
}
