/**
 * Workspace backfill migration script.
 *
 * Run once after applying the workspace schema changes in db/schema.sql.
 * Creates a solo workspace for every existing user and sets workspace_id
 * on all their content rows.
 *
 * Prerequisites:
 *   NEXT_PUBLIC_INSFORGE_URL, INSFORGE_SERVICE_ROLE_KEY set in environment.
 *
 * Usage:
 *   npx tsx scripts/migrate-workspaces.ts
 *
 * Safe to run multiple times — uses upsert + IF NOT EXISTS guards.
 */

import { createClient } from '@insforge/sdk';

const url = process.env.NEXT_PUBLIC_INSFORGE_URL;
const serviceKey = process.env.INSFORGE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_INSFORGE_URL or INSFORGE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const client = createClient({ baseUrl: url, anonKey: serviceKey, isServerMode: true });

// Tables that have workspace_id and need to be backfilled from user_id.
const CONTENT_TABLES = [
  'posts',
  'series',
  'story_bank',
  'content_ideas',
  'hashtag_sets',
  'weekly_reviews',
  'user_settings',
  'social_accounts',
  'publish_jobs',
  'ayrshare_profiles',
  'creator_brain_pages',
  'creator_profile',
] as const;

async function getAllUserIds(): Promise<string[]> {
  // Collect user IDs from creator_profile (most reliable user table).
  // Also pull from subscriptions in case some users skipped onboarding.
  const [profileRes, subRes] = await Promise.all([
    client.database.from('creator_profile').select('user_id'),
    client.database.from('subscriptions').select('user_id'),
  ]);

  const ids = new Set<string>();
  for (const row of profileRes.data ?? []) ids.add(row.user_id as string);
  for (const row of subRes.data ?? []) ids.add(row.user_id as string);
  return Array.from(ids);
}

async function ensureSoloWorkspace(userId: string): Promise<string> {
  // Check if workspace already exists.
  const { data: existing } = await client.database
    .from('workspace_members')
    .select('workspace_id')
    .eq('user_id', userId)
    .limit(1);

  if (existing && existing.length > 0) {
    return existing[0].workspace_id as string;
  }

  // Create solo workspace.
  const { data: ws, error } = await client.database
    .from('workspaces')
    .insert([{ owner_user_id: userId, name: 'My workspace', type: 'solo' }])
    .select('id')
    .single();

  if (error || !ws) throw new Error(`Could not create workspace for ${userId}: ${error?.message}`);

  const workspaceId = ws.id as string;

  // Add user as owner member.
  await client.database
    .from('workspace_members')
    .insert([{ workspace_id: workspaceId, user_id: userId, role: 'owner' }]);

  return workspaceId;
}

async function backfillTable(
  tableName: string,
  userId: string,
  workspaceId: string
): Promise<number> {
  // Only update rows that don't have workspace_id set yet.
  const { data, error } = await client.database
    .from(tableName)
    .update({ workspace_id: workspaceId })
    .eq('user_id', userId)
    .is('workspace_id', null)
    .select('id');

  if (error) {
    console.warn(`  [${tableName}] update error for user ${userId}: ${error.message}`);
    return 0;
  }

  return data?.length ?? 0;
}

async function main() {
  console.log('Starting workspace backfill migration...\n');

  const userIds = await getAllUserIds();
  console.log(`Found ${userIds.length} users to migrate.\n`);

  let totalWorkspacesCreated = 0;
  let totalRowsUpdated = 0;

  for (const userId of userIds) {
    try {
      const workspaceId = await ensureSoloWorkspace(userId);
      totalWorkspacesCreated++;
      console.log(`User ${userId} -> workspace ${workspaceId}`);

      for (const table of CONTENT_TABLES) {
        const count = await backfillTable(table, userId, workspaceId);
        if (count > 0) {
          console.log(`  ${table}: ${count} rows updated`);
          totalRowsUpdated += count;
        }
      }
    } catch (err) {
      console.error(`Failed for user ${userId}:`, err);
    }
  }

  console.log(`\nMigration complete.`);
  console.log(`  Workspaces created/confirmed: ${totalWorkspacesCreated}`);
  console.log(`  Rows backfilled with workspace_id: ${totalRowsUpdated}`);
  console.log(`\nNext step: apply workspace-based RLS policies in InsForge dashboard.`);
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
