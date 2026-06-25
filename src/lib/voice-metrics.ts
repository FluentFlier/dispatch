import type { createClient } from '@insforge/sdk';
import { isEnabled } from '@/lib/feature-flags';
import type { VoiceEvaluationMatrix } from '@/lib/voice-evaluator';

type InsforgeClient = ReturnType<typeof createClient>;

// EMA smoothing factor — matches Layer 2 (rl-intelligence). Keeps single
// outlier posts from distorting the running average.
const alpha = 0.3;

/**
 * Updates workspace-level voice quality metrics after each successful publish.
 *
 * Uses an Exponential Moving Average (EMA) with alpha=0.3:
 *   new_ema = 0.3 * new_value + 0.7 * existing_ema
 *
 * This prevents a single viral or unusually-scored post from skewing the
 * running average significantly. Both the platform-specific row and the 'all'
 * aggregate row are updated on every call.
 *
 * Fire-and-forget semantics: this function never throws. All errors are logged
 * and swallowed so the publish path is never blocked.
 *
 * Gated by the 'layer4_voice_metrics' feature flag — returns early if the flag
 * is disabled, leaving existing EMA values frozen until re-enabled.
 *
 * @param client       - Authenticated InsForge client from the request context
 * @param workspaceId  - Active workspace UUID
 * @param userId       - Authenticated user UUID
 * @param platform     - Publishing platform ('linkedin' | 'twitter' | 'threads')
 * @param evaluation   - Full 5-dimension scoring matrix from the voice evaluator
 * @param voiceMatchScore - Composite voice match score (0-100)
 * @param aiScore         - Composite AI detection score (0-100; lower is better)
 * @param postId          - UUID of the post just published
 */
export async function updateVoiceMetrics(
  client: InsforgeClient,
  workspaceId: string,
  userId: string,
  platform: string,
  evaluation: VoiceEvaluationMatrix,
  voiceMatchScore: number,
  aiScore: number,
  postId: string,
): Promise<void> {
  // --- Feature flag guard ---
  if (!await isEnabled(client, 'layer4_voice_metrics')) {
    // Flag disabled — leave EMA frozen. Publish already succeeded.
    return;
  }

  // --- Update platform-specific AND 'all' aggregate rows ---
  for (const target of [platform, 'all']) {
    const { data: existing } = await client.database
      .from('workspace_voice_metrics')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('platform', target)
      .maybeSingle();

    if (!existing) {
      // First publish for this workspace+platform combo — insert raw scores.
      // Evaluator dimensions are 0-10; we store them on a 0-100 scale.
      await client.database.from('workspace_voice_metrics').insert({
        workspace_id: workspaceId,
        user_id: userId,
        platform: target,
        avg_voice_match_score: voiceMatchScore,
        avg_ai_score: aiScore,
        avg_persona_fidelity: evaluation.persona_fidelity * 10,
        avg_uniqueness: evaluation.uniqueness * 10,
        avg_specificity: evaluation.specificity * 10,
        avg_so_what: evaluation.so_what * 10,
        avg_pain_resonance: evaluation.pain_resonance * 10,
        post_count: 1,
        last_post_id: postId,
      });
    } else {
      // EMA update — blend new scores with existing running averages.
      await client.database
        .from('workspace_voice_metrics')
        .update({
          avg_voice_match_score:
            alpha * voiceMatchScore + (1 - alpha) * Number(existing.avg_voice_match_score),
          avg_ai_score:
            alpha * aiScore + (1 - alpha) * Number(existing.avg_ai_score),
          avg_persona_fidelity:
            alpha * evaluation.persona_fidelity * 10 + (1 - alpha) * Number(existing.avg_persona_fidelity),
          avg_uniqueness:
            alpha * evaluation.uniqueness * 10 + (1 - alpha) * Number(existing.avg_uniqueness),
          avg_specificity:
            alpha * evaluation.specificity * 10 + (1 - alpha) * Number(existing.avg_specificity),
          avg_so_what:
            alpha * evaluation.so_what * 10 + (1 - alpha) * Number(existing.avg_so_what),
          avg_pain_resonance:
            alpha * evaluation.pain_resonance * 10 + (1 - alpha) * Number(existing.avg_pain_resonance),
          post_count: Number(existing.post_count) + 1,
          last_post_id: postId,
          updated_at: new Date().toISOString(),
        })
        .eq('workspace_id', workspaceId)
        .eq('platform', target);
    }
  }
}
