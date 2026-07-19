/**
 * Splits source text into overlapping windows for embedding. ~800 tokens per
 * chunk (~3200 chars) with ~400-char overlap so a sentence straddling a boundary
 * still lands whole in one chunk. Splits on paragraph/sentence boundaries when
 * possible, hard-cuts only when a single block exceeds the window.
 */
const CHUNK_CHARS = 3200;
const OVERLAP_CHARS = 400;
/** Never embed more than this many chunks from one source (cost + noise bound). */
const MAX_CHUNKS = 40;

export function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (!clean) return [];
  if (clean.length <= CHUNK_CHARS) return [clean];

  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length && chunks.length < MAX_CHUNKS) {
    let end = Math.min(start + CHUNK_CHARS, clean.length);
    if (end < clean.length) {
      // Prefer a paragraph, then sentence, then space boundary near the window end.
      const slice = clean.slice(start, end);
      const para = slice.lastIndexOf('\n\n');
      const sentence = slice.lastIndexOf('. ');
      const space = slice.lastIndexOf(' ');
      const cut = para > CHUNK_CHARS * 0.5 ? para
        : sentence > CHUNK_CHARS * 0.5 ? sentence + 1
        : space > CHUNK_CHARS * 0.5 ? space
        : slice.length;
      end = start + cut;
    }
    const chunk = clean.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= clean.length) break;
    start = Math.max(end - OVERLAP_CHARS, start + 1);
  }
  return chunks;
}
