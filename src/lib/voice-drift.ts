import type { createClient } from '@insforge/sdk';

type InsforgeClient = ReturnType<typeof createClient>;

export interface VoiceDriftReport {
  drifted: boolean;
  delta: number;
  baselineFidelity: number;
  currentFidelity: number;
  message: string;
}

/**
 * Compares current workspace voice EMA against onboarding baseline.
 * Alerts when persona fidelity drops meaningfully — triggers re-import suggestion.
 */
export async function detectVoiceDrift(
  client: InsforgeClient,
  workspaceId: string,
  userId: string,
  platform = 'linkedin',
): Promise<VoiceDriftReport> {
  const fallback: VoiceDriftReport = {
    drifted: false,
    delta: 0,
    baselineFidelity: 0,
    currentFidelity: 0,
    message: 'Insufficient data for drift detection.',
  };

  try {
    const { data: baseline } = await client.database
      .from('voice_drift_baselines')
      .select('baseline_persona_fidelity')
      .eq('workspace_id', workspaceId)
      .eq('platform', platform)
      .maybeSingle();

    const { data: current } = await client.database
      .from('workspace_voice_metrics')
      .select('avg_persona_fidelity, post_count')
      .eq('workspace_id', workspaceId)
      .eq('platform', platform)
      .maybeSingle();

    const baselineFidelity = Number(
      (baseline as { baseline_persona_fidelity?: number } | null)?.baseline_persona_fidelity ?? 0,
    );
    const currentFidelity = Number(
      (current as { avg_persona_fidelity?: number; post_count?: number } | null)?.avg_persona_fidelity ?? 0,
    );
    const postCount = Number(
      (current as { post_count?: number } | null)?.post_count ?? 0,
    );

    if (baselineFidelity <= 0 || postCount < 3) return fallback;

    const delta = baselineFidelity - currentFidelity;
    const drifted = delta >= 1.5;

    return {
      drifted,
      delta: Math.round(delta * 10) / 10,
      baselineFidelity,
      currentFidelity,
      message: drifted
        ? `Voice fidelity dropped ${delta.toFixed(1)} points vs onboarding. Consider re-importing posts in Voice Lab.`
        : 'Voice fidelity is stable vs your onboarding baseline.',
    };
  } catch {
    return fallback;
  }
}

/**
 * Captures onboarding persona fidelity as the drift reference point.
 */
export async function captureVoiceDriftBaseline(
  client: InsforgeClient,
  workspaceId: string,
  userId: string,
  personaFidelity: number,
  aiSlop = 3,
  platform = 'linkedin',
): Promise<void> {
  try {
    await client.database.from('voice_drift_baselines').upsert({
      workspace_id: workspaceId,
      user_id: userId,
      platform,
      baseline_persona_fidelity: personaFidelity,
      baseline_ai_slop: aiSlop,
      captured_at: new Date().toISOString(),
    }, { onConflict: 'workspace_id,platform' });
  } catch {
    // table may not exist until migration
  }
}
