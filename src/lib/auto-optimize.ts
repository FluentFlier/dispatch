import { getServerClient } from '@/lib/insforge/server';
import { PLATFORMS } from '@/lib/constants';
import type { Platform } from '@/lib/constants';

/**
 * Checks if auto-optimize is enabled for a user, and if so, triggers
 * background optimization to create variant posts linked by variant_group_id.
 *
 * This function is called after a post is created/updated with script or
 * caption content. It runs asynchronously (fire-and-forget) so it does not
 * block the response to the original POST/PATCH request.
 */
export async function triggerAutoOptimize({
  userId,
  postId,
  content,
  sourcePlatform,
  requestCookies,
  origin,
}: {
  userId: string;
  postId: string;
  content: string;
  sourcePlatform: string;
  requestCookies: string;
  origin: string;
}): Promise<void> {
  const client = getServerClient();

  // 1. Check user setting
  const { data: setting } = await client.database
    .from('user_settings')
    .select('value')
    .eq('user_id', userId)
    .eq('key', 'auto_optimize_on_save')
    .single();

  if (!setting || setting.value !== 'true') {
    return;
  }

  // 2. Determine target platforms (all except source)
  const targetPlatforms = PLATFORMS.filter(
    (p) => p !== sourcePlatform
  ) as Platform[];

  if (targetPlatforms.length === 0 || !content.trim()) {
    return;
  }

  const variantGroupId = crypto.randomUUID();

  // 3. Call POST /api/optimize using the internal service token instead of the
  //    original request cookies. The previous approach passed Cookie: requestCookies
  //    into a background fetch — if the serverless function completed before the
  //    background task ran, the session cookie was gone and the call returned 401.
  //    The CRON_SECRET header lets /api/optimize identify internal callers.
  try {
    const optimizeRes = await fetch(`${origin}/api/optimize`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-user-id': userId,
        Authorization: `Bearer ${process.env.CRON_SECRET ?? ''}`,
      },
      body: JSON.stringify({
        content,
        sourcePlatform: sourcePlatform as Platform,
        targetPlatforms,
        postId,
        optimizationLevel: 'full',
      }),
    });

    if (!optimizeRes.ok) {
      console.error('[auto-optimize] Optimization request failed:', optimizeRes.status);
      return;
    }

    const { variants } = await optimizeRes.json();

    if (!variants || !Array.isArray(variants) || variants.length === 0) {
      return;
    }

    // 4. Fetch the source post to inherit title and pillar
    const { data: sourcePost } = await client.database
      .from('posts')
      .select('title, pillar')
      .eq('id', postId)
      .eq('user_id', userId)
      .single();

    if (!sourcePost) return;

    // 5. Create variant posts and assign variant_group_id to source post only
    //    AFTER variants are confirmed — setting it before meant the source post
    //    appeared in a group with no siblings when the optimize call failed.
    const variantPosts = variants.map(
      (v: { platform: string; content: string }) => ({
        user_id: userId,
        title: `${sourcePost.title} (${v.platform})`,
        pillar: sourcePost.pillar,
        platform: v.platform,
        status: 'scripted' as const,
        caption: v.content,
        variant_group_id: variantGroupId,
        source_platform: sourcePlatform,
      })
    );

    await client.database.from('posts').insert(variantPosts);

    // Update source post with variant_group_id only after variants are created.
    await client.database
      .from('posts')
      .update({ variant_group_id: variantGroupId, source_platform: sourcePlatform })
      .eq('id', postId)
      .eq('user_id', userId);
  } catch (err) {
    console.error('[auto-optimize] Background optimization error:', err);
  }
}
