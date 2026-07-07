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
import { persistImportedPosts, firstImageUrl } from '@/lib/voice-lab/persist-imported-posts';

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

  it('imports the first image attachment into image_url', async () => {
    const { client, insertedPosts } = fakeClient();
    await persistImportedPosts({
      client: client as never,
      userId: 'u1',
      workspaceId: 'ws1',
      platform: 'linkedin',
      items: [{
        id: 'p3',
        text: 'A historical post that had a photo attached to it on LinkedIn.',
        attachments: [
          { type: 'img', url: 'https://media.licdn.com/img/abc.jpg' },
          { type: 'img', url: 'https://media.licdn.com/img/second.jpg' },
        ],
      }],
    });
    expect(insertedPosts[0].image_url).toBe('https://media.licdn.com/img/abc.jpg');
  });

  it('sets image_url to null for a text-only post', async () => {
    const { client, insertedPosts } = fakeClient();
    await persistImportedPosts({
      client: client as never,
      userId: 'u1',
      workspaceId: 'ws1',
      platform: 'linkedin',
      items: [{ id: 'p4', text: 'A plain text post with no media attached at all here.' }],
    });
    expect(insertedPosts[0].image_url).toBeNull();
  });

  it('writes publish_jobs with workspace_id so restored imports stay workspace-visible', async () => {
    const insertedJobs: Array<Record<string, unknown>> = [];
    const client = {
      database: {
        from(table: string) {
          if (table === 'publish_jobs') {
            return {
              select: () => ({ eq: () => ({ limit: () => ({ data: [], error: null }) }) }),
              insert: (rows: Array<Record<string, unknown>>) => {
                insertedJobs.push(...rows);
                return { error: null };
              },
            };
          }
          return { insert: () => ({ error: null }) };
        },
      },
    };

    await persistImportedPosts({
      client: client as never,
      userId: 'u1',
      workspaceId: 'ws1',
      platform: 'linkedin',
      items: [{ id: 'p5', content: 'A restored LinkedIn post using the provider content field.' }],
    });

    expect(insertedJobs[0]).toMatchObject({ workspace_id: 'ws1', provider_post_id: 'p5' });
  });

  describe('firstImageUrl', () => {
    it('returns the first img attachment url', () => {
      expect(firstImageUrl({ attachments: [{ type: 'video', url: 'v' }, { type: 'img', url: 'i' }] })).toBe('i');
    });
    it('returns null when there are no image attachments', () => {
      expect(firstImageUrl({ attachments: [{ type: 'video', url: 'v' }] })).toBeNull();
      expect(firstImageUrl({})).toBeNull();
    });
    it('ignores img attachments with no url', () => {
      expect(firstImageUrl({ attachments: [{ type: 'img' }] })).toBeNull();
    });
  });
});
