/**
 * One-time cleanup for the Unipile cross-tenant sync bug.
 *
 * The old syncUnipileAccountsForUser claimed EVERY unclaimed account returned
 * by Unipile's shared-key GET /accounts for whoever pressed "Sync from
 * Unipile" — assigning strangers' LinkedIn/X accounts (and importing their
 * posts) to the wrong user. PR #193 fixed the binding logic going forward;
 * this script repairs the rows and content the old code already poisoned.
 *
 * Classification per social_accounts row (unipile_account_id not null):
 *   OK         — Unipile account.name === row.user_id (hosted-auth stamp)
 *   MISMATCH   — account.name is a DIFFERENT known user id (provably stolen)
 *   STALE      — unipile_account_id no longer exists in Unipile (rotated id)
 *   UNVERIFIED — account.name is not a user id (legacy connect); needs a
 *                human eyeball: does the profile name match the user?
 *
 * Dry-run by default: prints the report and what WOULD change.
 * With --apply, for every MISMATCH row:
 *   1. Unlinks the row (unipile_account_id/account_id/account_name/connected_at → null)
 *   2. Deletes the posts + publish_jobs imported through the wrong account
 *      (publish_jobs.provider='unipile' rows for that user+platform whose
 *      posts row was created by import: pillar='general' AND status='posted')
 *   3. Clears imported voice samples (user_settings sample_posts/voice_source
 *      when voice_source='imported')
 * With --apply --unlink-stale, STALE rows are unlinked too (step 1 only).
 * UNVERIFIED rows are NEVER mutated — review them manually.
 *
 * Prerequisites:
 *   NEXT_PUBLIC_INSFORGE_URL, INSFORGE_SERVICE_ROLE_KEY,
 *   UNIPILE_API_KEY, UNIPILE_DSN set in environment (production values).
 *
 * Usage:
 *   npx tsx scripts/cleanup-unipile-cross-tenant.ts            # report only
 *   npx tsx scripts/cleanup-unipile-cross-tenant.ts --apply
 *   npx tsx scripts/cleanup-unipile-cross-tenant.ts --apply --unlink-stale
 */

import { createClient } from '@insforge/sdk';

const url = process.env.NEXT_PUBLIC_INSFORGE_URL;
const serviceKey = process.env.INSFORGE_SERVICE_ROLE_KEY;
const unipileKey = process.env.UNIPILE_API_KEY;
const unipileDsn = process.env.UNIPILE_DSN;

if (!url || !serviceKey || !unipileKey || !unipileDsn) {
  console.error(
    'Missing env: NEXT_PUBLIC_INSFORGE_URL, INSFORGE_SERVICE_ROLE_KEY, UNIPILE_API_KEY, UNIPILE_DSN',
  );
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');
const UNLINK_STALE = process.argv.includes('--unlink-stale');

const client = createClient({ baseUrl: url, anonKey: serviceKey, isServerMode: true });

interface UnipileAccount {
  id: string;
  type?: string;
  name?: string;
  username?: string;
  connection_params?: {
    im?: { username?: string; publicIdentifier?: string; memberId?: string; id?: string };
  };
}

interface SocialAccountRow {
  id: string;
  user_id: string;
  platform: string;
  unipile_account_id: string;
  account_id: string | null;
  account_name: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function fetchAllUnipileAccounts(): Promise<UnipileAccount[]> {
  const base = unipileDsn!.startsWith('http') ? unipileDsn! : `https://${unipileDsn}`;
  const accounts: UnipileAccount[] = [];
  let cursor: string | null = null;

  do {
    const qs = new URLSearchParams({ limit: '250' });
    if (cursor) qs.set('cursor', cursor);
    const res = await fetch(`${base}/api/v1/accounts?${qs}`, {
      headers: { 'X-API-KEY': unipileKey!, accept: 'application/json' },
    });
    if (!res.ok) {
      console.error(`Unipile GET /accounts failed: ${res.status} ${await res.text()}`);
      process.exit(1);
    }
    const json = (await res.json()) as {
      items?: UnipileAccount[];
      accounts?: UnipileAccount[];
      data?: UnipileAccount[];
      cursor?: string | null;
      paging?: { cursor?: string | null };
    };
    accounts.push(...(json.items ?? json.accounts ?? json.data ?? []));
    cursor = json.cursor ?? json.paging?.cursor ?? null;
  } while (cursor);

  return accounts;
}

function displayName(a: UnipileAccount | undefined): string {
  if (!a) return '(gone)';
  return a.connection_params?.im?.username ?? a.name ?? a.username ?? '(unnamed)';
}

async function unlinkRow(row: SocialAccountRow): Promise<void> {
  const { error } = await client.database
    .from('social_accounts')
    .update({
      unipile_account_id: null,
      account_id: null,
      account_name: null,
      connected_at: null,
    })
    .eq('id', row.id);
  if (error) throw new Error(`unlink ${row.id}: ${error.message}`);
}

async function purgeImportedContent(row: SocialAccountRow): Promise<{ posts: number; jobs: number }> {
  const { data: jobs } = await client.database
    .from('publish_jobs')
    .select('id, post_id')
    .eq('user_id', row.user_id)
    .eq('platform', row.platform)
    .eq('provider', 'unipile');
  const jobRows = (jobs ?? []) as Array<{ id: string; post_id: string | null }>;
  if (jobRows.length === 0) return { posts: 0, jobs: 0 };

  const postIds = jobRows.map((j) => j.post_id).filter(Boolean) as string[];

  // Only posts created BY the import (pillar 'general' + already 'posted') —
  // posts the user authored and published through the app keep their pillar.
  const { data: importedPosts } = postIds.length
    ? await client.database
      .from('posts')
      .select('id')
      .in('id', postIds)
      .eq('user_id', row.user_id)
      .eq('pillar', 'general')
      .eq('status', 'posted')
    : { data: [] };
  const importedPostIds = ((importedPosts ?? []) as Array<{ id: string }>).map((p) => p.id);
  const importedPostIdSet = new Set(importedPostIds);
  const jobIdsToDelete = jobRows
    .filter((j) => j.post_id && importedPostIdSet.has(j.post_id))
    .map((j) => j.id);

  if (!APPLY) return { posts: importedPostIds.length, jobs: jobIdsToDelete.length };

  if (jobIdsToDelete.length) {
    const { error } = await client.database.from('publish_jobs').delete().in('id', jobIdsToDelete);
    if (error) throw new Error(`delete publish_jobs for ${row.user_id}: ${error.message}`);
  }
  if (importedPostIds.length) {
    const { error } = await client.database.from('posts').delete().in('id', importedPostIds);
    if (error) throw new Error(`delete posts for ${row.user_id}: ${error.message}`);
  }
  return { posts: importedPostIds.length, jobs: jobIdsToDelete.length };
}

async function clearImportedVoiceSamples(userId: string): Promise<boolean> {
  const { data } = await client.database
    .from('user_settings')
    .select('id, key, value')
    .eq('user_id', userId)
    .in('key', ['sample_posts', 'voice_source']);
  const rows = (data ?? []) as Array<{ id: string; key: string; value: string }>;
  const source = rows.find((r) => r.key === 'voice_source');
  if (source?.value !== 'imported') return false;

  if (APPLY) {
    const ids = rows.map((r) => r.id);
    const { error } = await client.database.from('user_settings').delete().in('id', ids);
    if (error) throw new Error(`clear voice samples for ${userId}: ${error.message}`);
  }
  return true;
}

async function main() {
  console.log(`Mode: ${APPLY ? 'APPLY (mutating)' : 'DRY RUN (report only)'}\n`);

  const accounts = await fetchAllUnipileAccounts();
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const uuidNamed = accounts.filter((a) => UUID_RE.test(a.name ?? ''));
  console.log(`Unipile accounts: ${accounts.length} total, ${uuidNamed.length} with uuid-like name (hosted-auth stamped)`);
  if (uuidNamed.length === 0) {
    console.log(
      '⚠️  NO accounts carry a user-id name stamp. Either Unipile does not preserve the\n' +
      '   hosted-auth name, or all accounts predate the stamp. MISMATCH detection is\n' +
      '   impossible — every linked row will classify as UNVERIFIED. Do not --apply;\n' +
      '   review manually.\n',
    );
  }

  const { data: rowsData } = await client.database
    .from('social_accounts')
    .select('id, user_id, platform, unipile_account_id, account_id, account_name')
    .not('unipile_account_id', 'is', null);
  const rows = (rowsData ?? []) as SocialAccountRow[];
  const knownUserIds = new Set(rows.map((r) => r.user_id));
  console.log(`social_accounts rows with a Unipile link: ${rows.length}\n`);

  const buckets: Record<string, SocialAccountRow[]> = { OK: [], MISMATCH: [], STALE: [], UNVERIFIED: [] };

  for (const row of rows) {
    const account = accountById.get(row.unipile_account_id);
    if (!account) buckets.STALE.push(row);
    else if (account.name === row.user_id) buckets.OK.push(row);
    else if (UUID_RE.test(account.name ?? '') || knownUserIds.has(account.name ?? '')) buckets.MISMATCH.push(row);
    else buckets.UNVERIFIED.push(row);
  }

  for (const [label, bucket] of Object.entries(buckets)) {
    console.log(`── ${label} (${bucket.length}) ──`);
    for (const row of bucket) {
      const account = accountById.get(row.unipile_account_id);
      console.log(
        `  user=${row.user_id} platform=${row.platform} row_name="${row.account_name}"` +
        ` unipile_name="${account?.name ?? '(gone)'}" profile="${displayName(account)}"`,
      );
    }
    console.log();
  }

  const toUnlink = [...buckets.MISMATCH, ...(UNLINK_STALE ? buckets.STALE : [])];
  for (const row of toUnlink) {
    const isMismatch = buckets.MISMATCH.includes(row);
    if (APPLY) await unlinkRow(row);
    console.log(`${APPLY ? 'Unlinked' : 'Would unlink'} ${row.platform} row for user ${row.user_id}`);

    if (isMismatch) {
      const purged = await purgeImportedContent(row);
      console.log(
        `  ${APPLY ? 'Purged' : 'Would purge'} ${purged.posts} imported posts, ${purged.jobs} publish_jobs`,
      );
      const clearedVoice = await clearImportedVoiceSamples(row.user_id);
      if (clearedVoice) {
        console.log(`  ${APPLY ? 'Cleared' : 'Would clear'} imported voice samples`);
      }
    }
  }

  if (!APPLY && toUnlink.length > 0) {
    console.log('\nRe-run with --apply to make these changes.');
  }
  console.log('\nDone. UNVERIFIED rows need manual review — compare profile name to the user.');
}

main().catch((err) => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
