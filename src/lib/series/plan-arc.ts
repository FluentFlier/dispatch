import type { createClient } from '@insforge/sdk';
import { chatCompletion } from '@/lib/llm';
import { parseLlmJson } from '@/lib/llm-json';
import { retrieveBrainContext } from '@/lib/brain';
import { retrieveSeriesGrounding } from './retrieve';
import type { SeriesArcPart } from './types';

type InsforgeClient = ReturnType<typeof createClient>;

export interface PlanArcParams {
  client: InsforgeClient;
  seriesId: string;
  userId: string;
  workspaceId: string | null;
  concept: string;
  description?: string | null;
  numParts: number;
  platform?: string | null;
}

/**
 * Generates the series arc: a skeleton of `numParts` parts, each with a title,
 * hook, one-sentence core point, and a bridge to the next part. Grounded on the
 * dropped source material (pgvector) plus the creator's voice/background (Brain),
 * so the arc reflects the user's actual references and voice, not generic filler.
 *
 * Returns exactly `numParts` parts (padded/truncated if the model miscounts) so
 * downstream persistence can rely on positions 1..numParts.
 */
export async function planSeriesArc(params: PlanArcParams): Promise<SeriesArcPart[]> {
  const { client, seriesId, userId, workspaceId, concept, description, numParts, platform } = params;

  const [grounding, brainSnippets] = await Promise.all([
    retrieveSeriesGrounding(client, seriesId, `${concept}\n${description ?? ''}`, 10),
    retrieveBrainContext(client, userId, concept, workspaceId ?? undefined).catch(() => [] as string[]),
  ]);

  const contextBlock = [
    grounding,
    brainSnippets.length ? `CREATOR CONTEXT:\n${brainSnippets.join('\n\n')}` : '',
  ].filter(Boolean).join('\n\n');

  const system = [
    'You are a senior content strategist who maps multi-part social media series.',
    'A great series: each part stands alone but rewards watching all; part 1 is the strongest hook;',
    'the arc builds toward a payoff; every part ends on a bridge that pulls the viewer to the next.',
    'Write in the creator\'s voice and ground every part in the supplied source material. No em dashes.',
    'Respond with ONLY a JSON object, no prose.',
  ].join(' ');

  const user = [
    `Plan a ${numParts}-part ${platform ?? 'social'} content series.`,
    `SERIES CONCEPT: ${concept}`,
    description ? `NOTES: ${description}` : '',
    contextBlock ? `\n${contextBlock}` : '',
    '',
    `Return JSON of this exact shape:`,
    `{"parts":[{"position":1,"title":"...","hook":"...","core_point":"...","bridge":"..."}]}`,
    `- position: 1..${numParts}, in order`,
    `- title: punchy episode title`,
    `- hook: the first spoken/written line of the part`,
    `- core_point: one sentence on what this part establishes`,
    `- bridge: how this part makes them want the next one`,
  ].filter(Boolean).join('\n');

  const raw = await chatCompletion(system, user, {
    role: 'generate',
    temperature: 0.7,
    maxTokens: 2000,
    responseFormat: 'json',
  });

  const parsed = parseLlmJson<{ parts?: Partial<SeriesArcPart>[] }>(raw);
  const rawParts = Array.isArray(parsed?.parts) ? parsed!.parts! : [];

  const parts: SeriesArcPart[] = [];
  for (let i = 0; i < numParts; i++) {
    const p = rawParts[i] ?? {};
    parts.push({
      position: i + 1,
      title: (p.title ?? `Part ${i + 1}`).toString().slice(0, 200),
      hook: (p.hook ?? '').toString().slice(0, 1000),
      core_point: (p.core_point ?? '').toString().slice(0, 1000),
      bridge: (p.bridge ?? '').toString().slice(0, 1000),
    });
  }
  return parts;
}
