import { embedBatch, EMBED_DIM } from '@/lib/embeddings';

/**
 * Series-only embeddings with a provider fallback.
 *
 * The niche/hook RAG is locked to OpenAI text-embedding-3-small because its
 * vectors live in one shared pgvector space - mixing providers there would
 * corrupt cosine matches. Series chunks are a SEPARATE, self-contained space:
 * every chunk AND every query for a series flows through this one function, so
 * any consistent provider works. That lets us fall back to Hugging Face when no
 * OpenAI key is configured (the common case here - LLM gen runs on Cerebras/Groq).
 *
 * OpenAI returns native 512-dim vectors. The HF model returns 384; we zero-pad to
 * 512 to fit the vector(512) column. Zero-padding is lossless for cosine (the pad
 * dims add nothing to the dot product or either norm), so retrieval is unaffected.
 * ponytail: one small HF model, padded. If a deployment switches embedding
 * providers mid-life, already-stored chunks stay in the old space until re-ingested.
 */

const HF_EMBED_MODEL = 'sentence-transformers/all-MiniLM-L6-v2';
const HF_URL = `https://router.huggingface.co/hf-inference/models/${HF_EMBED_MODEL}/pipeline/feature-extraction`;

function hasOpenAiKey(): boolean {
  return Boolean(process.env.OPENAI_EMBEDDINGS_KEY?.trim() || process.env.OPENAI_API_KEY?.trim());
}

function padTo512(v: number[]): number[] {
  if (v.length === EMBED_DIM) return v;
  if (v.length > EMBED_DIM) return v.slice(0, EMBED_DIM);
  return v.concat(new Array(EMBED_DIM - v.length).fill(0));
}

async function hfEmbed(texts: string[], retry = true): Promise<number[][]> {
  const key = process.env.HUGGINGFACE_API_KEY?.trim();
  if (!key) {
    throw new Error(
      '[series/embed] No embedding provider. Set OPENAI_EMBEDDINGS_KEY (native 512) ' +
      'or HUGGINGFACE_API_KEY (fallback). Source grounding needs one of these.',
    );
  }
  const res = await fetch(HF_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ inputs: texts, options: { wait_for_model: true } }),
    signal: AbortSignal.timeout(60_000),
  });
  // 503 = model cold-starting; retry once after it warms.
  if (res.status === 503 && retry) return hfEmbed(texts, false);
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`[series/embed] HF ${res.status}: ${detail.slice(0, 200)}`);
  }
  const json = (await res.json()) as number[] | number[][];
  // HF returns a flat vector for a single input, or an array of vectors for many.
  const rows: number[][] = Array.isArray(json[0]) ? (json as number[][]) : [json as number[]];
  if (rows.length !== texts.length) {
    throw new Error(`[series/embed] HF returned ${rows.length} vectors for ${texts.length} inputs`);
  }
  return rows.map(padTo512);
}

/** Embeds a batch for series indexing/retrieval. OpenAI when keyed, else HF. */
export async function embedSeriesBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (hasOpenAiKey()) return embedBatch(texts);
  return hfEmbed(texts);
}

/** Embeds one string for series retrieval. */
export async function embedSeriesText(text: string): Promise<number[]> {
  const [vec] = await embedSeriesBatch([text]);
  return vec;
}
