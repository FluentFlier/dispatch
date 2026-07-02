/**
 * Phase: Imported Posts Visibility
 *
 * Regression tests for the bug where LinkedIn posts imported via the Voice Lab
 * "import from account" flow were persisted to the `posts` table but stayed
 * invisible in the Library/Calendar. Two causes, both covered here:
 *  1. Empty `pillars` array — the Calendar filters posts by pillar, so an empty
 *     array made imported posts vanish. The writer must set `pillars: ['general']`.
 *  2. Null `workspace_id` — every posts read is workspace-scoped, so a null
 *     workspace made rows unreadable. The writer must persist a concrete workspace.
 */
import { describe, it, expect } from 'vitest';
import { persistImportedPosts } from '@/lib/voice-lab/persist-imported-posts';

/** Fake InsForge client that captures rows inserted into `posts`. */
function fakeClient() {
  const insertedPosts: Array<Record<string, unknown>> = [];
  const client = {
    database: {
      from(table: string) {
        if (table === 'publish_jobs') {
          return {
            // No existing tracked job → the writer proceeds to insert.
            select: () => ({ eq: () => ({ limit: () => ({ data: [], error: null }) }) }),
            insert: () => ({ error: null }),
          };
        }
        // posts
        return {
          insert: (rows: Array<Record<string, unknown>>) => {
            insertedPosts.push(...rows);
            return { error: null };
          },
        };
      },
    },
  };
  return { client, insertedPosts };
}

describe('Phase: Imported Posts Visibility', () => {
  it('writes imported posts with pillars:["general"] so the Calendar pillar filter does not drop them', async () => {
    const { client, insertedPosts } = fakeClient();
    await persistImportedPosts({
      client: client as never,
      userId: 'u1',
      workspaceId: 'ws1',
      platform: 'linkedin',
      items: [{ id: 'p1', text: 'A real historical LinkedIn post with enough substance to matter.' }],
    });
    expect(insertedPosts).toHaveLength(1);
    expect(insertedPosts[0]).toMatchObject({
      user_id: 'u1',
      workspace_id: 'ws1',
      pillar: 'general',
      pillars: ['general'],
      status: 'posted',
    });
  });

  it('preserves the passed workspace_id so the row is readable by the workspace-scoped posts API', async () => {
    const { client, insertedPosts } = fakeClient();
    await persistImportedPosts({
      client: client as never,
      userId: 'u1',
      workspaceId: 'ws-xyz',
      platform: 'linkedin',
      items: [{ id: 'p2', text: 'Another substantial historical post from the connected account.' }],
    });
    expect(insertedPosts[0].workspace_id).toBe('ws-xyz');
  });
});
