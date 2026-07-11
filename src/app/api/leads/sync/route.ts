import { NextResponse } from 'next/server';
import { getAuthenticatedUser, getServerClient } from '@/lib/insforge/server';
import { getActiveWorkspaceId } from '@/lib/workspace';
import { syncWorkspaceDirectory } from '@/lib/signals/ingest/sync-directory';

// TinyFish Agent scrape runs are slow (~60-130s). Give the function the max
// serverless budget so a live scrape isn't cut off at the default cap.
export const runtime = 'nodejs';
export const maxDuration = 300;

/**
 * POST /api/leads/sync
 * Manual directory scrape for the active workspace (the "Scrape now" action).
 *
 * Streams newline-delimited JSON (NDJSON) so the client can render live
 * progress instead of staring at a frozen screen for ~1-2 minutes:
 *   {"type":"progress","phase":"resolving","label":"…","pct":63,"current":40,"total":130}
 *   …
 *   {"type":"result","result":{…DirectorySyncResult…}}   // terminal, on success
 *   {"type":"error","error":"Directory sync failed."}      // terminal, on failure
 *
 * Uses the seed provider when TINYFISH_API_KEY is absent so the flow is
 * testable end-to-end without live scraping.
 */
export async function POST(): Promise<Response> {
  const user = await getAuthenticatedUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const workspaceId = await getActiveWorkspaceId(user.id);
  if (!workspaceId) return NextResponse.json({ error: 'No active workspace' }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (msg: unknown) => {
        controller.enqueue(encoder.encode(JSON.stringify(msg) + '\n'));
      };
      try {
        const client = getServerClient();
        const result = await syncWorkspaceDirectory(client, workspaceId, {
          onProgress: (p) => send({ type: 'progress', ...p }),
        });
        send({ type: 'result', result });
      } catch (err) {
        console.error('[leads/sync] directory sync failed:', err);
        send({ type: 'error', error: 'Directory sync failed.' });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      // Defeat proxy buffering so progress ticks flush immediately.
      'X-Accel-Buffering': 'no',
    },
  });
}
