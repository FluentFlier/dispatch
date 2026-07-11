/**
 * OpenAI text-embedding-3-small at 512 dims - the single provider-locked call in
 * the intelligence stack (spec 0.3). Everything else routes through the generic
 * LLM abstraction; embeddings do not, because we need one stable vector space for
 * pgvector cosine search and dimension truncation is an OpenAI-specific request
 * param. Key: OPENAI_EMBEDDINGS_KEY, falling back to OPENAI_API_KEY.
 */

export const EMBED_DIM = 512;
const MODEL = 'text-embedding-3-small';
const ENDPOINT = 'https://api.openai.com/v1/embeddings';

/** Resolves the embeddings key or throws with a fix hint. Never returns ''. */
export function embeddingsKey(): string {
  const key = process.env.OPENAI_EMBEDDINGS_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();
  if (!key) {
    throw new Error(
      '[embeddings] Missing OPENAI_EMBEDDINGS_KEY (or OPENAI_API_KEY). ' +
      'Niche resolution and hook retrieval need text-embedding-3-small. ' +
      'Set OPENAI_EMBEDDINGS_KEY in .env.local (Vercel: add it and redeploy).',
    );
  }
  return key;
}

/** Serializes a vector to the pgvector text literal match_niche_hooks expects. */
export function toPgVector(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

/**
 * Parses a pgvector column value read back through PostgREST, which serializes
 * `vector` as a JSON string like "[1,2,3]" rather than a JSON array (verified
 * live). Every read site MUST route embeddings through this before cosineSim -
 * feeding cosineSim(number[], string) silently produces NaN, which compares
 * false against every threshold and looks like "no match found".
 * Returns null (not []) for anything unparseable so callers can skip + count
 * the row instead of guessing.
 */
export function parseVec(e: unknown): number[] | null {
  if (Array.isArray(e)) return e as number[];
  if (typeof e === 'string') {
    try {
      const parsed = JSON.parse(e);
      return Array.isArray(parsed) ? (parsed as number[]) : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Embeds a batch of strings. One request; order preserved. */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const key = embeddingsKey();
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: texts, dimensions: EMBED_DIM }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`[embeddings] OpenAI returned ${res.status}: ${detail.slice(0, 200)}`);
  }
  const json = (await res.json()) as { data?: Array<{ index: number; embedding: number[] }> };
  const data = json.data ?? [];
  if (data.length !== texts.length) {
    throw new Error(`[embeddings] expected ${texts.length} vectors, got ${data.length}`);
  }
  const out: number[][] = new Array(texts.length);
  for (const d of data) {
    out[d.index] = d.embedding;
  }
  for (let i = 0; i < out.length; i++) {
    if (out[i] === undefined) {
      throw new Error(`[embeddings] missing embedding at index ${i} (malformed response)`);
    }
  }
  return out;
}

/** Embeds one string. */
export async function embedText(text: string): Promise<number[]> {
  const [vec] = await embedBatch([text]);
  return vec;
}
