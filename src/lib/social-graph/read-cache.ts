import { createHash } from 'crypto';
import { getServiceClient } from '@/lib/insforge/server';

const DEFAULT_TTL_MS = 15 * 60 * 1000;

/**
 * UseSocial-style read cache: repeated agent/UI reads of the same post reactions
 * hit Postgres instead of Unipile within the TTL window.
 */
export async function getCachedRead<T>(key: string): Promise<T | null> {
  const client = getServiceClient();
  const now = new Date().toISOString();
  const { data } = await client.database
    .from('social_graph_read_cache')
    .select('payload')
    .eq('cache_key', key)
    .gt('expires_at', now)
    .maybeSingle();

  return (data?.payload as T) ?? null;
}

/**
 * Store a cached read payload with TTL (default 15 minutes, matching UseSocial).
 */
export async function setCachedRead(key: string, payload: unknown, ttlMs = DEFAULT_TTL_MS): Promise<void> {
  const client = getServiceClient();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const cacheKey = key.slice(0, 500);

  await client.database.from('social_graph_read_cache').upsert(
    [
      {
        cache_key: cacheKey,
        payload,
        expires_at: expiresAt,
      },
    ],
    { onConflict: 'cache_key' },
  );
}

/**
 * Build a stable cache key for a user's post-reactions read.
 */
export function reactionsCacheKey(userId: string, socialPostId: string, platform: string): string {
  const raw = `reactions:${userId}:${platform}:${socialPostId}`;
  return createHash('sha256').update(raw).digest('hex');
}

export const SOCIAL_GRAPH_CACHE_TTL_SECONDS = DEFAULT_TTL_MS / 1000;
