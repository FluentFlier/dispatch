/**
 * One-off: describe the single image_url already stored on posts imported
 * before multi-image capture existed, and re-upsert their memory entry with
 * that image context. This recovers only the ONE image Unipile import kept
 * historically (firstImageUrl()) - any additional photos a post originally
 * had were never stored anywhere and can only be recovered by reconnecting
 * the account and re-running the live Unipile import.
 *
 * Usage: npx tsx scripts/backfill-existing-image.mts
 */
import { createClient } from '@insforge/sdk';
import { describeImage } from '../src/lib/llm';
import { addMemory } from '../src/lib/supermemory';
import { memoryScopeTag, buildPostMemoryCustomId } from '../src/lib/memory/write';

const url = process.env.NEXT_PUBLIC_INSFORGE_URL;
const serviceKey = process.env.INSFORGE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_INSFORGE_URL or INSFORGE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const client = createClient({ baseUrl: url.replace(/\/+$/, ''), anonKey: serviceKey, isServerMode: true });

async function main(): Promise<void> {
  const { data: rows, error } = await client.database
    .from('posts')
    .select('id, user_id, workspace_id, platform, hook, script, caption, posted_date, image_url, images')
    .eq('status', 'posted')
    .not('image_url', 'is', null)
    .limit(500);
  if (error) { console.error(error); process.exit(1); }

  const candidates = (rows ?? []).filter((r: { images: unknown }) => Array.isArray(r.images) && r.images.length === 0);
  console.log(`[backfill-image] ${candidates.length} posts with image_url but no images[]`);

  let done = 0;
  for (const r of candidates as Array<{
    id: string; user_id: string; workspace_id: string | null; platform: string | null;
    hook: string | null; script: string | null; caption: string | null; posted_date: string | null; image_url: string;
  }>) {
    const description = await describeImage(r.image_url);
    await client.database.from('posts').update({ images: [{ url: r.image_url, description }] }).eq('id', r.id);

    if (description) {
      const body = [r.hook, r.script, r.caption].filter(Boolean).join('\n\n').trim();
      const posted = r.posted_date ? r.posted_date.split('T')[0] : '';
      const { data: job } = await client.database
        .from('publish_jobs')
        .select('provider_post_id')
        .eq('post_id', r.id)
        .maybeSingle();
      const providerPostId = (job as { provider_post_id: string | null } | null)?.provider_post_id ?? null;
      await addMemory({
        content:
          `[Your ${r.platform ?? 'social'} post from ${posted || 'unknown date'}] — this ALREADY happened; reference as past.\n\n` +
          `${body}\n\nPhoto: ${description}`,
        containerTags: [memoryScopeTag(r.user_id, r.workspace_id), 'imported_post'],
        customId: buildPostMemoryCustomId(r.platform, providerPostId, r.id),
        metadata: { type: 'imported_post', platform: r.platform ?? '', posted_date: posted },
      });
    }
    done++;
    console.log(`[backfill-image] ${done}/${candidates.length} - ${r.id} - ${description ? 'described' : 'no description'}`);
  }
  console.log(`[backfill-image] done: ${done} processed`);
}

void main();
