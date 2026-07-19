import type { createClient } from '@insforge/sdk';
import { loadCreatorVoiceContext } from '@/lib/voice-context';
import { generateWithVoicePipeline, type VoicePipelineResult } from '@/lib/voice-pipeline';
import { retrieveSeriesGrounding } from './retrieve';
import type { SeriesRow, SeriesArcPart } from './types';

type InsforgeClient = ReturnType<typeof createClient>;

/**
 * Writes the full publishable draft for one series part through the real content
 * pipeline (base -> hooks -> humanize -> voice -> evaluate), grounded on:
 *  - the series' dropped source material (pgvector, injected via contextAdditions),
 *  - the creator's voice + persona + past posts (loadCreatorVoiceContext, which
 *    already blends Brain + Supermemory + Story Bank).
 *
 * Threading source grounding through contextAdditions means zero changes to the
 * shared pipeline - it consumes the same extra-context channel /api/generate uses.
 */
export async function generateSeriesPart(params: {
  client: InsforgeClient;
  userId: string;
  workspaceId: string | null;
  series: SeriesRow;
  part: SeriesArcPart;
}): Promise<VoicePipelineResult> {
  const { client, userId, workspaceId, series, part } = params;
  const query = `${part.title}. ${part.core_point}`.trim();

  const [voiceCtx, grounding] = await Promise.all([
    loadCreatorVoiceContext(client, userId, {
      memoryQuery: query || series.name,
      memoryLimit: 5,
      workspaceId: workspaceId ?? undefined,
      platform: series.platform ?? undefined,
    }),
    retrieveSeriesGrounding(client, series.id, query || series.name, 8),
  ]);

  const contextAdditions = [voiceCtx.contextAdditions, grounding]
    .filter(Boolean)
    .join('\n\n') || undefined;

  const userPrompt = [
    `Write part ${part.position} of ${series.total_parts} in the "${series.name}" series.`,
    series.description ? `Series premise: ${series.description}` : '',
    `This part's title: ${part.title}`,
    part.hook ? `Open with this hook idea: ${part.hook}` : '',
    part.core_point ? `Core point to land: ${part.core_point}` : '',
    part.bridge ? `End by bridging to the next part: ${part.bridge}` : '',
    '',
    'Write the finished post in the creator\'s voice, grounded in the source material above.',
    'It must stand alone but clearly belong to the series. No em dashes.',
  ].filter(Boolean).join('\n');

  return generateWithVoicePipeline({
    userPrompt,
    profile: voiceCtx.profile,
    contextAdditions,
    platform: series.platform ?? undefined,
    contentType: 'post',
    useVoice: true,
    hooksClient: client,
    vocabulary: voiceCtx.vocabulary,
    structural: voiceCtx.structural,
  });
}
