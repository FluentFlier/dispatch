#!/usr/bin/env npx tsx
/**
 * Seed demo profile + sample Signals for an existing InsForge user.
 *
 * Prerequisites:
 *   NEXT_PUBLIC_INSFORGE_URL, INSFORGE_SERVICE_ROLE_KEY in env (.env.local)
 *
 * Usage:
 *   set -a && source .env.local && set +a && npx tsx scripts/seed-demo-user.ts --user-id=<uuid>
 *
 * Get user_id: InsForge dashboard → Auth → Users, or browser devtools after login.
 */

import { createClient } from '@insforge/sdk';
import { seedDemoWorkspace } from '../src/lib/demo/seed-workspace';

const url = process.env.NEXT_PUBLIC_INSFORGE_URL;
const serviceKey = process.env.INSFORGE_SERVICE_ROLE_KEY;

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split('=').slice(1).join('=');
}

async function main() {
  const userId = arg('user-id');
  const workspaceIdArg = arg('workspace-id');

  if (!url || !serviceKey) {
    console.error('Missing NEXT_PUBLIC_INSFORGE_URL or INSFORGE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  if (!userId) {
    console.error(`
Usage: npx tsx scripts/seed-demo-user.ts --user-id=<uuid> [--workspace-id=<uuid>]

1. Sign up at /login (Google or GitHub)
2. Copy your user id from InsForge Auth → Users
3. Run this script

Demo account tip: use a dedicated Google account like demo+dispatch@gmail.com
`);
    process.exit(1);
  }

  const client = createClient({ baseUrl: url.replace(/\/+$/, ''), anonKey: serviceKey, isServerMode: true });

  let workspaceId = workspaceIdArg;
  if (!workspaceId) {
    const { data: member } = await client.database
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();
    workspaceId = member?.workspace_id as string | undefined;
  }

  if (!workspaceId) {
    const { data: ws, error } = await client.database
      .from('workspaces')
      .insert([{ owner_user_id: userId, name: 'Demo workspace', type: 'solo' }])
      .select('id')
      .single();
    if (error || !ws) {
      console.error('Could not create workspace:', error?.message);
      process.exit(1);
    }
    workspaceId = ws.id as string;
    await client.database
      .from('workspace_members')
      .insert([{ workspace_id: workspaceId, user_id: userId, role: 'owner' }]);
  }

  console.log(`Seeding demo for user ${userId} workspace ${workspaceId}...`);
  const result = await seedDemoWorkspace(client, userId, workspaceId);
  console.log(JSON.stringify(result, null, 2));
  console.log('\nDone. Open /signals to review demo outreach targets.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
