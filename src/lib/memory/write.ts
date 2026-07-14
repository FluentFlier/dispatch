import type { getServerClient } from '@/lib/insforge/server';
import { isEnabled } from '@/lib/feature-flags';
import { addMemory, listMemories, deleteMemory } from '@/lib/supermemory';

type Client = ReturnType<typeof getServerClient>;

export type MemoryKind =
  | 'published_post'
  | 'imported_post'
  | 'event_answer'
  | 'story_bank'
  | 'edited_post'
  | 'post_image';

export interface WriteToMemoryArgs {
  userId: string;
  workspaceId: string | null;
  kind: MemoryKind;
  /** Full content to embed. For post-like kinds this already carries the dated
   *  temporal header (see the memory design spec §5.1) so retrieval surfaces the
   *  date and generation treats it as history, not a style template. */
  content: string;
  /** Idempotent key. Post kinds key on the platform URN when one exists so the
   *  same real post from the publish path and the import path collapse to one
   *  document; see buildPostMemoryCustomId. */
  customId: string;
  metadata: Record<string, string | number | boolean>;
}

/** Container tag that scopes a memory to a workspace (agency) or a solo user. */
export function memoryScopeTag(userId: string, workspaceId: string | null): string {
  return workspaceId ? `workspace_${workspaceId}` : `user_${userId}`;
}

/**
 * Canonical customId for a post-like memory. Keys on the platform post identity
 * (LinkedIn/X URN) when available so the publish path and the import path never
 * create two documents for the same real-world post; falls back to the internal
 * row id for drafts that were never published externally.
 */
export function buildPostMemoryCustomId(
  platform: string | null | undefined,
  providerPostId: string | null | undefined,
  internalPostId: string,
): string {
  // Sanitize to a conservative charset. Platform URNs contain ':' (e.g.
  // urn:li:activity:123) which the memory store may reject, silently dropping the
  // write. Both the write and the delete path go through this fn, so they stay
  // consistent regardless of sanitization.
  const safe = (s: string): string => s.replace(/[^A-Za-z0-9_-]/g, '_');
  if (providerPostId && platform) return `post_${safe(platform)}_${safe(providerPostId)}`;
  return `post_${safe(internalPostId)}`;
}

/**
 * Customid for one image's description, written as its OWN memory document
 * (not appended inside the parent post's content). A description tacked onto
 * the end of a long post competes with the post's other chunks for search
 * ranking and can lose to them even when the query is specifically about the
 * photo; a standalone document gets its own independent shot at surfacing.
 */
export function buildImageMemoryCustomId(internalPostId: string, index: number): string {
  return `image_${internalPostId.replace(/[^A-Za-z0-9_-]/g, '_')}_${index}`;
}

/**
 * Single entry point for every memory write. Non-blocking by contract: it never
 * throws to the caller. Gated by the `layer3_memory_writes` feature flag and
 * idempotent by customId (Supermemory upserts on customId).
 *
 * IMPORTANT for callers in serverless routes/crons: `await` this before the
 * handler returns. "Non-blocking" means it swallows its own errors, NOT that you
 * may fire-and-forget it in a request that is about to end — an un-awaited write
 * is dropped when the lambda freezes.
 *
 * Returns true only when a document was actually written (false on flag-off,
 * empty content, or a swallowed error). The backfill uses this to mark rows only
 * on real success so failures are retried on the next run.
 */
export async function writeToMemory(client: Client, args: WriteToMemoryArgs): Promise<boolean> {
  try {
    if (!args.content.trim()) return false;
    if (!(await isEnabled(client, 'layer3_memory_writes'))) return false;
    await addMemory({
      content: args.content,
      containerTags: [memoryScopeTag(args.userId, args.workspaceId), args.kind],
      customId: args.customId,
      metadata: { type: args.kind, ...args.metadata },
    });
    console.log(`[memory] wrote kind=${args.kind} customId=${args.customId}`);
    return true;
  } catch (err) {
    console.error(
      `[memory] write failed (non-blocking) kind=${args.kind} customId=${args.customId}:`,
      err,
    );
    return false;
  }
}

/**
 * Removes a memory document by its customId so retrieval never surfaces content
 * the user deleted. Best-effort and non-blocking.
 *
 * ponytail: Supermemory's helper has no get-by-customId, so we page the scoped
 * document list and match. Bounded to the first 300 docs (3 pages) so a post
 * delete can't fan out into many round-trips — fine for v1 per-user volumes; swap
 * in a direct customId lookup if archives grow past that. Best-effort: a miss just
 * leaves a stale doc, and the deleted post is never regenerated from it anyway.
 */
export async function deleteFromMemory(
  userId: string,
  workspaceId: string | null,
  customId: string,
): Promise<void> {
  try {
    const scopeTag = memoryScopeTag(userId, workspaceId);
    for (let page = 1; page <= 3; page++) {
      const { memories } = await listMemories([scopeTag], 100, page);
      if (!memories.length) break;
      const hit = memories.find((m) => m.customId === customId);
      if (hit?.id) {
        await deleteMemory(hit.id);
        console.log(`[memory] deleted customId=${customId}`);
        return;
      }
      if (memories.length < 100) break;
    }
  } catch (err) {
    console.error(`[memory] delete failed (non-blocking) customId=${customId}:`, err);
  }
}
