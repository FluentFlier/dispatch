/**
 * Maintenance script: reclassifies stale `signal_events` rows whose
 * company_name (and related fields) were computed by an older classifier
 * version — most notably rows where company_name is a bare stopword like
 * "the" (Issue 1a). The live classifier (src/lib/signals/classifier.ts) has
 * carried a defense-in-depth stopword guard since this fix; this script
 * repairs the DATA that predates it. It does not change any live code path
 * and is NOT wired to a cron — run it by hand after the fix ships.
 *
 * Prerequisites (same pattern as scripts/migrate-workspaces.ts):
 *   NEXT_PUBLIC_INSFORGE_URL, INSFORGE_SERVICE_ROLE_KEY set in environment.
 *
 * Usage:
 *   npx tsx scripts/reclassify-signals.ts
 *   npx tsx scripts/reclassify-signals.ts --workspace <workspace_id>
 *
 * Idempotent: re-running is safe. Rows whose company_name is already a valid
 * non-stopword name, or whose raw post no longer recovers a company, are
 * left untouched.
 */

import { createClient } from '@insforge/sdk';
import { COMPANY_STOPWORDS } from '@/lib/signals/classifier';
import { classifyPostHybrid } from '@/lib/signals/detect/hybrid';
import type { IngestedPost, SignalEventRow, SignalRawPostRow } from '@/lib/signals/types';

const url = process.env.NEXT_PUBLIC_INSFORGE_URL;
const serviceKey = process.env.INSFORGE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    'Missing NEXT_PUBLIC_INSFORGE_URL or INSFORGE_SERVICE_ROLE_KEY.\n' +
    'This script needs the InsForge service-role client to update signal_events ' +
    'across workspaces. Set both in your environment (e.g. .env.local) before running:\n' +
    '  npx tsx --env-file=.env.local scripts/reclassify-signals.ts',
  );
  process.exit(1);
}

const client = createClient({ baseUrl: url, anonKey: serviceKey, isServerMode: true });

interface EventWithPost extends SignalEventRow {
  raw_post: SignalRawPostRow | null;
}

/** True when the stored company_name is bad data worth reclassifying:
 *  a known stopword, or too short to be a real name. Null is handled
 *  separately (see `isNullRecoverable`) since null is often a legitimate
 *  "no company found" result, not necessarily stale data. */
function isStopwordCompany(companyName: string | null): boolean {
  if (!companyName) return false;
  return COMPANY_STOPWORDS.has(companyName.toLowerCase()) || companyName.length < 2;
}

/** Builds the IngestedPost shape classifyPostHybrid expects from a stored raw post row. */
function toIngestedPost(rawPost: SignalRawPostRow): IngestedPost {
  return {
    platform: rawPost.platform,
    externalPostId: rawPost.external_post_id,
    authorHandle: rawPost.author_handle ?? undefined,
    authorName: rawPost.author_name ?? undefined,
    content: rawPost.content,
    postUrl: rawPost.post_url ?? undefined,
    postedAt: rawPost.posted_at ?? undefined,
    rawPayload: rawPost.raw_payload ?? undefined,
  };
}

/** Fetches signal_events + raw_post for one workspace, or all workspaces when omitted. */
async function loadEvents(workspaceId?: string): Promise<EventWithPost[]> {
  let query = client.database
    .from('signal_events')
    .select(`
      id, workspace_id, raw_post_id, signal_type, company_name, person_name,
      accelerator_name, batch, signal_summary, confidence, dedupe_key, status,
      created_at, updated_at,
      raw_post:signal_raw_posts(*)
    `)
    .limit(5000);

  if (workspaceId) query = query.eq('workspace_id', workspaceId);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to load signal_events: ${error.message}`);

  return (data ?? []).map((row) => ({
    ...(row as SignalEventRow),
    raw_post: row.raw_post as unknown as SignalRawPostRow | null,
  }));
}

/** Reclassifies and updates a single event row. Returns true if it changed. */
async function reclassifyOne(event: EventWithPost): Promise<boolean> {
  if (!event.raw_post) {
    console.log(`  SKIP  ${event.id} — no raw_post to reclassify from`);
    return false;
  }

  const needsFix = isStopwordCompany(event.company_name) || event.company_name === null;
  if (!needsFix) return false;

  const post = toIngestedPost(event.raw_post);
  const classified = await classifyPostHybrid(post);

  if (!classified) {
    console.log(`  SKIP  ${event.id} — reclassify produced no signal, leaving as-is`);
    return false;
  }

  const nextCompany = classified.companyName ?? null;
  const nextPerson = classified.personName ?? null;
  const nextAccelerator = classified.acceleratorName ?? null;
  const nextBatch = classified.batch ?? null;

  const unchanged =
    nextCompany === event.company_name &&
    nextPerson === event.person_name &&
    nextAccelerator === event.accelerator_name &&
    nextBatch === event.batch;

  if (unchanged) {
    console.log(`  SKIP  ${event.id} — reclassify agrees with stored data`);
    return false;
  }

  const { error } = await client.database
    .from('signal_events')
    .update({
      company_name: nextCompany,
      person_name: nextPerson,
      accelerator_name: nextAccelerator,
      batch: nextBatch,
    })
    .eq('id', event.id);

  if (error) {
    console.error(`  FAIL  ${event.id} — update error: ${error.message}`);
    return false;
  }

  console.log(
    `  FIXED ${event.id} — company_name "${event.company_name ?? 'null'}" -> "${nextCompany ?? 'null'}"`,
  );
  return true;
}

async function main() {
  const workspaceArgIdx = process.argv.indexOf('--workspace');
  const workspaceId = workspaceArgIdx !== -1 ? process.argv[workspaceArgIdx + 1] : undefined;

  console.log(
    workspaceId
      ? `Reclassifying stale signal_events for workspace ${workspaceId}...\n`
      : 'Reclassifying stale signal_events across all workspaces...\n',
  );

  const events = await loadEvents(workspaceId);
  console.log(`Loaded ${events.length} signal_events row(s).\n`);

  const candidates = events.filter(
    (e) => isStopwordCompany(e.company_name) || e.company_name === null,
  );
  console.log(`${candidates.length} row(s) flagged for reclassification.\n`);

  let fixedCount = 0;
  for (const event of candidates) {
    try {
      const fixed = await reclassifyOne(event);
      if (fixed) fixedCount++;
    } catch (err) {
      // Log and continue — one bad row must not abort the whole maintenance run.
      console.error(`  ERROR ${event.id} —`, err);
    }
  }

  console.log(`\nDone. ${fixedCount} of ${candidates.length} flagged row(s) updated.`);
}

main().catch((err) => {
  console.error('Reclassify script failed:', err);
  process.exit(1);
});
