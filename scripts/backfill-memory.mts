/**
 * Live Memory backfill.
 *
 * One-time pass that writes already-existing history into semantic memory so
 * pre-fix content (e.g. a LinkedIn post imported before the write path existed)
 * becomes visible to generation. Going-forward writes happen live at each action
 * site; this only catches the backlog.
 *
 * Covers three tables: posts (status='posted'), event_captures (answered), and
 * story_bank. Idempotent two ways: the memory_synced_at marker column (skip done
 * rows) and the customId upsert (safe even if a row is re-processed before its
 * marker commits).
 *
 * Prerequisites:
 *   - db/live-memory-markers.sql applied (adds memory_synced_at columns).
 *   - feature_flags.layer3_memory_writes = true.
 *   - NEXT_PUBLIC_INSFORGE_URL, INSFORGE_SERVICE_ROLE_KEY, SUPERMEMORY_API_KEY set.
 *
 * Usage:
 *   npx tsx scripts/backfill-memory.mts
 *   MEMORY_BACKFILL_MAX=500 npx tsx scripts/backfill-memory.mts   # cap total writes
 *
 * Uses relative imports (not the @/ alias) so it runs under tsx unchanged.
 * .mts extension (not .ts): this project has no "type": "module" in
 * package.json, so tsx runs plain .ts files as CommonJS by default, which
 * makes @insforge/sdk resolve its CJS build - and that build's require() of
 * @insforge/shared-schemas (an ESM-only package, no "require" export
 * condition) crashes with ERR_PACKAGE_PATH_NOT_EXPORTED. .mts forces
 * unambiguous ESM regardless of package.json, sidestepping the whole mess.
 */

import { createClient } from '@insforge/sdk';
import { addMemory } from '../src/lib/supermemory';
import { memoryScopeTag, buildPostMemoryCustomId, buildImageMemoryCustomId } from '../src/lib/memory/write';
import { buildQuestionsAndAnswers } from '../src/lib/event-capture/draft-context';

const url = process.env.NEXT_PUBLIC_INSFORGE_URL;
const serviceKey = process.env.INSFORGE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_INSFORGE_URL or INSFORGE_SERVICE_ROLE_KEY');
  process.exit(1);
}
if (!process.env.SUPERMEMORY_API_KEY) {
  console.error('Missing SUPERMEMORY_API_KEY');
  process.exit(1);
}

// Strip trailing slash: an env value ending in "/" doubles up with the SDK's
// leading-slash paths ("//api/database/...") and 404s. Matches the same
// normalization src/lib/insforge/server.ts applies for the app's own clients.
const client = createClient({ baseUrl: url.replace(/\/+$/, ''), anonKey: serviceKey, isServerMode: true });
const MAX = Number(process.env.MEMORY_BACKFILL_MAX ?? 100000);
const PAGE = 25;
const SLEEP_MS = 200;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dateOnly = (s: string | null | undefined): string => (s ? s.split('T')[0] : '');
const pastHeader = (label: string, body: string): string =>
  `${label} - this ALREADY happened; reference as past.\n\n${body}`;

let written = 0;
let failed = 0;

/** Marks a row synced only after a successful memory write. */
async function mark(table: string, id: string): Promise<void> {
  await client.database.from(table).update({ memory_synced_at: new Date().toISOString() }).eq('id', id);
}

async function ensureFlagOn(): Promise<boolean> {
  const { data } = await client.database
    .from('feature_flags')
    .select('enabled')
    .eq('name', 'layer3_memory_writes')
    .maybeSingle();
  // Row missing = default open (matches isEnabled semantics).
  return !data || (data as { enabled: boolean }).enabled === true;
}

async function backfillPosts(): Promise<void> {
  for (;;) {
    if (written >= MAX) return;
    const { data: rows } = await client.database
      .from('posts')
      .select('id, user_id, workspace_id, platform, hook, script, caption, posted_date, images')
      .eq('status', 'posted')
      .is('memory_synced_at', null)
      .order('posted_date', { ascending: true })
      .limit(PAGE);
    if (!rows?.length) return;

    for (const r of rows as Array<{
      id: string; user_id: string; workspace_id: string | null; platform: string | null;
      hook: string | null; script: string | null; caption: string | null; posted_date: string | null;
      images: Array<{ url: string; description: string | null }> | null;
    }>) {
      if (written >= MAX) return;
      const body = [r.hook, r.script, r.caption].filter(Boolean).join('\n\n').trim();
      if (!body) { await mark('posts', r.id); continue; }

      const { data: job } = await client.database
        .from('publish_jobs')
        .select('provider_post_id')
        .eq('post_id', r.id)
        .eq('user_id', r.user_id)
        .maybeSingle();
      const providerPostId = (job as { provider_post_id: string | null } | null)?.provider_post_id ?? null;
      const posted = dateOnly(r.posted_date);

      try {
        await addMemory({
          content: pastHeader(`[Your ${r.platform ?? 'social'} post from ${posted || 'unknown date'}]`, body),
          containerTags: [memoryScopeTag(r.user_id, r.workspace_id), 'imported_post'],
          customId: buildPostMemoryCustomId(r.platform, providerPostId, r.id),
          metadata: { type: 'imported_post', platform: r.platform ?? '', posted_date: posted },
        });
        // Each described image gets its own standalone memory document (not
        // appended into the post's content) - a description tacked onto a long
        // post competes with the post's other chunks for search ranking; a
        // standalone doc gets an independent shot at surfacing.
        for (const [i, img] of (r.images ?? []).entries()) {
          if (!img.description) continue;
          await addMemory({
            content: pastHeader(`[Photo from your ${r.platform ?? 'social'} post on ${posted || 'unknown date'}]`, img.description),
            containerTags: [memoryScopeTag(r.user_id, r.workspace_id), 'post_image'],
            customId: buildImageMemoryCustomId(r.id, i),
            metadata: { type: 'post_image', platform: r.platform ?? '', posted_date: posted },
          });
        }
        await mark('posts', r.id);
        written++;
      } catch (err) {
        failed++;
        console.error('[backfill] post failed', r.id, err);
      }
      await sleep(SLEEP_MS);
    }
    console.log(`[backfill] posts: ${written} written, ${failed} failed`);
  }
}

async function backfillEvents(): Promise<void> {
  for (;;) {
    if (written >= MAX) return;
    const { data: rows } = await client.database
      .from('event_captures')
      .select('id, user_id, workspace_id, title, start_time, questions, answers')
      .not('answers', 'is', null)
      .is('memory_synced_at', null)
      .order('start_time', { ascending: true })
      .limit(PAGE);
    if (!rows?.length) return;

    for (const r of rows as Array<{
      id: string; user_id: string; workspace_id: string | null; title: string | null;
      start_time: string | null; questions: string[] | null; answers: Record<string, string> | null;
    }>) {
      if (written >= MAX) return;
      const qa = buildQuestionsAndAnswers(r.questions, r.answers);
      if (!qa) { await mark('event_captures', r.id); continue; }
      const eventDate = dateOnly(r.start_time);

      try {
        await addMemory({
          content: pastHeader(`[From ${r.title ?? 'an event'} on ${eventDate || 'unknown date'}]`, qa),
          containerTags: [memoryScopeTag(r.user_id, r.workspace_id), 'event_answer'],
          customId: `event_${r.id}`,
          metadata: { type: 'event_answer', event_title: r.title ?? '', posted_date: eventDate },
        });
        await mark('event_captures', r.id);
        written++;
      } catch (err) {
        failed++;
        console.error('[backfill] event failed', r.id, err);
      }
      await sleep(SLEEP_MS);
    }
    console.log(`[backfill] events: ${written} written, ${failed} failed`);
  }
}

async function backfillStories(): Promise<void> {
  for (;;) {
    if (written >= MAX) return;
    const { data: rows } = await client.database
      .from('story_bank')
      .select('id, user_id, workspace_id, title, body, raw_memory, category')
      .is('memory_synced_at', null)
      .order('created_at', { ascending: true })
      .limit(PAGE);
    if (!rows?.length) return;

    for (const r of rows as Array<{
      id: string; user_id: string; workspace_id: string | null;
      title: string | null; body: string | null; raw_memory: string | null; category: string | null;
    }>) {
      if (written >= MAX) return;
      const body = (r.body ?? r.raw_memory ?? r.title ?? '').trim();
      if (!body) { await mark('story_bank', r.id); continue; }

      try {
        await addMemory({
          content: body,
          containerTags: [memoryScopeTag(r.user_id, r.workspace_id), 'story_bank'],
          customId: `story_${r.id}`,
          metadata: { type: 'story_bank', category: r.category ?? '' },
        });
        await mark('story_bank', r.id);
        written++;
      } catch (err) {
        failed++;
        console.error('[backfill] story failed', r.id, err);
      }
      await sleep(SLEEP_MS);
    }
    console.log(`[backfill] stories: ${written} written, ${failed} failed`);
  }
}

async function main(): Promise<void> {
  if (!(await ensureFlagOn())) {
    console.error('layer3_memory_writes is OFF - enable it before backfilling. Aborting.');
    process.exit(1);
  }
  console.log(`[backfill] starting (max ${MAX})`);
  await backfillPosts();
  await backfillEvents();
  await backfillStories();
  console.log(`[backfill] done: ${written} written, ${failed} failed`);
}

void main();
