import { getServiceClient } from '@/lib/insforge/server';
import { PLATFORMS } from '@/lib/constants';
import type { Platform } from '@/lib/constants';
import { loadCreatorVoiceContext } from '@/lib/voice-context';
import { guardAiRequest } from '@/lib/ai-guard';
import {
  generateOptimizeVariants,
  type OptimizePlatform,
} from '@/lib/optimize-variants';

/**
 * Checks if auto-optimize is enabled for a user, and if so, generates
 * platform variants in-process and inserts them as linked posts.
 *
 * Runs fire-and-forget from POST/PATCH /api/posts - no HTTP round-trip,
 * so it does not depend on session cookies surviving after the response.
 * Pass workspaceId from the request handler (do not resolve via cookies here).
 */
export async function triggerAutoOptimize({
  userId,
  postId,
  content,
  sourcePlatform,
  workspaceId,
}: {
  userId: string;
  postId: string;
  content: string;
  sourcePlatform: string;
  workspaceId?: string | null;
  /** @deprecated unused - kept for call-site compatibility during rollout */
  requestCookies?: string;
  /** @deprecated unused - kept for call-site compatibility during rollout */
  origin?: string;
}): Promise<void> {
  // Service client: background work must not depend on request cookies / RLS session.
  const client = getServiceClient();

  const { data: setting } = await client.database
    .from('user_settings')
    .select('value')
    .eq('user_id', userId)
    .eq('key', 'auto_optimize_on_save')
    .single();

  if (!setting || setting.value !== 'true') {
    return;
  }

  const targetPlatforms = PLATFORMS.filter(
    (p) => p !== sourcePlatform,
  ) as OptimizePlatform[];

  if (targetPlatforms.length === 0 || !content.trim()) {
    return;
  }

  const guard = await guardAiRequest(userId);
  if (!guard.ok) {
    console.error('[auto-optimize] AI guard blocked:', guard.error);
    return;
  }

  const variantGroupId = crypto.randomUUID();

  try {
    const { profile, contextAdditions } = await loadCreatorVoiceContext(client, userId, {
      memoryQuery: content.slice(0, 200),
      workspaceId: workspaceId ?? undefined,
    });

    const { variants, errors } = await generateOptimizeVariants({
      content,
      targetPlatforms,
      optimizationLevel: 'full',
      profile,
      contextAdditions,
    });

    if (errors.length > 0) {
      console.error('[auto-optimize] Partial optimize errors:', errors);
    }

    if (!variants || variants.length === 0) {
      return;
    }

    const { data: sourcePost } = await client.database
      .from('posts')
      .select('title, pillar, workspace_id')
      .eq('id', postId)
      .eq('user_id', userId)
      .single();

    if (!sourcePost) return;

    const variantPosts = variants.map((v) => ({
      user_id: userId,
      workspace_id: sourcePost.workspace_id ?? workspaceId ?? null,
      title: `${sourcePost.title} (${v.platform})`,
      pillar: sourcePost.pillar,
      platform: v.platform as Platform,
      status: 'scripted' as const,
      caption: v.content,
      variant_group_id: variantGroupId,
      source_platform: sourcePlatform,
    }));

    await client.database.from('posts').insert(variantPosts);

    await client.database
      .from('posts')
      .update({ variant_group_id: variantGroupId, source_platform: sourcePlatform })
      .eq('id', postId)
      .eq('user_id', userId);
  } catch (err) {
    console.error('[auto-optimize] Background optimization error:', err);
  }
}
