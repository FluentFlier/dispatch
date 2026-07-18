import type { createClient } from '@insforge/sdk';
import { toPgVector } from '@/lib/embeddings';
import { embedSeriesBatch } from './embed';
import { chunkText } from './chunk';
import type { SourceKind } from './types';

type InsforgeClient = ReturnType<typeof createClient>;

export interface IngestParams {
  seriesId: string;
  userId: string;
  workspaceId: string | null;
  kind: SourceKind;
  title?: string;
  sourceRef?: string;
  /** Already-extracted plain text (file parsed / URL fetched / pasted / entity copied). */
  rawText: string;
}

export interface IngestResult {
  sourceId: string;
  status: 'ready' | 'failed';
  chunkCount: number;
  charCount: number;
  error?: string;
}

/**
 * Persists one resource as a series_source and its embedded chunks. Every input
 * type (file/text/url/story_bank/post) is normalized to plain text upstream and
 * flows through this single path: chunk -> embed -> insert. The source row is
 * inserted first so a failed embed still leaves an auditable 'failed' record the
 * user can retry or delete, rather than a silently dropped upload.
 */
export async function ingestSource(
  client: InsforgeClient,
  params: IngestParams,
): Promise<IngestResult> {
  const { seriesId, userId, workspaceId, kind, title, sourceRef, rawText } = params;
  const text = rawText.trim();
  const charCount = text.length;

  const { data: source, error: sourceErr } = await client.database
    .from('series_sources')
    .insert([{
      series_id: seriesId,
      user_id: userId,
      workspace_id: workspaceId,
      kind,
      title: title ?? null,
      source_ref: sourceRef ?? null,
      raw_text: text,
      char_count: charCount,
      status: 'pending',
    }])
    .select('id')
    .single();

  if (sourceErr || !source) {
    throw new Error(sourceErr?.message ?? 'Could not save source');
  }
  const sourceId = (source as { id: string }).id;

  const chunks = chunkText(text);
  if (chunks.length === 0) {
    await client.database
      .from('series_sources')
      .update({ status: 'failed', error: 'No text to index.' })
      .eq('id', sourceId);
    return { sourceId, status: 'failed', chunkCount: 0, charCount, error: 'No text to index.' };
  }

  try {
    const vectors = await embedSeriesBatch(chunks);
    const rows = chunks.map((content, i) => ({
      series_id: seriesId,
      source_id: sourceId,
      user_id: userId,
      workspace_id: workspaceId,
      chunk_index: i,
      content,
      embedding: toPgVector(vectors[i]),
    }));
    const { error: chunkErr } = await client.database.from('series_chunks').insert(rows);
    if (chunkErr) throw new Error(chunkErr.message);

    await client.database
      .from('series_sources')
      .update({ status: 'ready' })
      .eq('id', sourceId);
    return { sourceId, status: 'ready', chunkCount: chunks.length, charCount };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Embedding failed';
    await client.database
      .from('series_sources')
      .update({ status: 'failed', error: message.slice(0, 500) })
      .eq('id', sourceId);
    return { sourceId, status: 'failed', chunkCount: 0, charCount, error: message };
  }
}
