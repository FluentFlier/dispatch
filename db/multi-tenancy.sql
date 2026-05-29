-- ============================================================================
-- Tiered multi-tenancy: workspaces + workspace_members + workspace_id scoping
-- ============================================================================
-- Solo creators get one auto-created "solo" workspace. Agencies/social-media
-- managers get many "client" workspaces, each with its own trained voice,
-- connected socials, calendar, inbox, and analytics.
--
-- Apply in TWO stages so prod is never broken:
--   PART 1 (additive, safe to apply anytime): new tables + nullable
--           workspace_id columns + backfill. The app keeps working unchanged
--           because it still scopes by user_id; workspace_id is just populated.
--   PART 2 (RLS rewrite): apply ONLY AFTER the app is workspace-aware (every
--           insert sets workspace_id and every read filters by the active
--           workspace). Applying PART 2 before the code switch will break all
--           writes, because inserts without workspace_id fail the WITH CHECK.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- PART 1: additive schema + backfill  (NON-BREAKING)
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS workspaces (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL,
  name          text NOT NULL,
  type          text NOT NULL DEFAULT 'solo' CHECK (type IN ('solo', 'client')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_workspaces_owner ON workspaces (owner_user_id);

CREATE TABLE IF NOT EXISTS workspace_members (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  user_id      uuid NOT NULL,
  role         text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner', 'manager', 'viewer')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members (user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_ws ON workspace_members (workspace_id);

-- Add nullable workspace_id to every tenant-owned table (additive).
ALTER TABLE creator_profile     ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE posts               ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE social_accounts     ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE ayrshare_profiles   ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE publish_jobs        ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE comment_reply_queue ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE post_comments       ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE content_ideas       ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE story_bank          ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE series              ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE hashtag_sets        ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE detected_trends     ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE weekly_reviews      ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE media_attachments   ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE creator_brain_pages ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE usage_counters      ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE usage_events        ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE user_settings       ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE lead_categories     ADD COLUMN IF NOT EXISTS workspace_id uuid;
ALTER TABLE subscriptions       ADD COLUMN IF NOT EXISTS workspace_id uuid;

-- Backfill: one solo workspace + owner membership per existing user.
INSERT INTO workspaces (owner_user_id, name, type)
SELECT DISTINCT u.uid, 'My workspace', 'solo'
FROM (
  SELECT user_id AS uid FROM creator_profile WHERE user_id IS NOT NULL
  UNION SELECT user_id FROM posts WHERE user_id IS NOT NULL
  UNION SELECT user_id FROM subscriptions WHERE user_id IS NOT NULL
  UNION SELECT user_id FROM social_accounts WHERE user_id IS NOT NULL
  UNION SELECT user_id FROM user_settings WHERE user_id IS NOT NULL
) u
WHERE NOT EXISTS (
  SELECT 1 FROM workspaces w WHERE w.owner_user_id = u.uid AND w.type = 'solo'
);

INSERT INTO workspace_members (workspace_id, user_id, role)
SELECT w.id, w.owner_user_id, 'owner'
FROM workspaces w
WHERE w.type = 'solo'
  AND NOT EXISTS (
    SELECT 1 FROM workspace_members m
    WHERE m.workspace_id = w.id AND m.user_id = w.owner_user_id
  );

-- Point each tenant row at its owner's solo workspace.
UPDATE creator_profile t     SET workspace_id = w.id FROM workspaces w WHERE w.owner_user_id = t.user_id        AND w.type='solo' AND t.workspace_id IS NULL;
UPDATE posts t               SET workspace_id = w.id FROM workspaces w WHERE w.owner_user_id = t.user_id        AND w.type='solo' AND t.workspace_id IS NULL;
UPDATE social_accounts t     SET workspace_id = w.id FROM workspaces w WHERE w.owner_user_id = t.user_id        AND w.type='solo' AND t.workspace_id IS NULL;
UPDATE ayrshare_profiles t   SET workspace_id = w.id FROM workspaces w WHERE w.owner_user_id = t.user_id        AND w.type='solo' AND t.workspace_id IS NULL;
UPDATE publish_jobs t        SET workspace_id = w.id FROM workspaces w WHERE w.owner_user_id = t.user_id        AND w.type='solo' AND t.workspace_id IS NULL;
UPDATE comment_reply_queue t SET workspace_id = w.id FROM workspaces w WHERE w.owner_user_id = t.user_id        AND w.type='solo' AND t.workspace_id IS NULL;
UPDATE post_comments t       SET workspace_id = w.id FROM workspaces w WHERE w.owner_user_id = t.user_id        AND w.type='solo' AND t.workspace_id IS NULL;
UPDATE content_ideas t       SET workspace_id = w.id FROM workspaces w WHERE w.owner_user_id = t.user_id        AND w.type='solo' AND t.workspace_id IS NULL;
UPDATE story_bank t          SET workspace_id = w.id FROM workspaces w WHERE w.owner_user_id = t.user_id        AND w.type='solo' AND t.workspace_id IS NULL;
UPDATE series t              SET workspace_id = w.id FROM workspaces w WHERE w.owner_user_id = t.user_id        AND w.type='solo' AND t.workspace_id IS NULL;
UPDATE hashtag_sets t        SET workspace_id = w.id FROM workspaces w WHERE w.owner_user_id = t.user_id        AND w.type='solo' AND t.workspace_id IS NULL;
UPDATE detected_trends t     SET workspace_id = w.id FROM workspaces w WHERE w.owner_user_id = t.user_id        AND w.type='solo' AND t.workspace_id IS NULL;
UPDATE weekly_reviews t      SET workspace_id = w.id FROM workspaces w WHERE w.owner_user_id = t.user_id        AND w.type='solo' AND t.workspace_id IS NULL;
UPDATE media_attachments t   SET workspace_id = w.id FROM workspaces w WHERE w.owner_user_id = t.user_id        AND w.type='solo' AND t.workspace_id IS NULL;
UPDATE creator_brain_pages t SET workspace_id = w.id FROM workspaces w WHERE w.owner_user_id = t.user_id        AND w.type='solo' AND t.workspace_id IS NULL;
UPDATE usage_counters t      SET workspace_id = w.id FROM workspaces w WHERE w.owner_user_id = t.user_id        AND w.type='solo' AND t.workspace_id IS NULL;
UPDATE usage_events t         SET workspace_id = w.id FROM workspaces w WHERE w.owner_user_id = t.user_id       AND w.type='solo' AND t.workspace_id IS NULL;
UPDATE user_settings t       SET workspace_id = w.id FROM workspaces w WHERE w.owner_user_id = t.user_id        AND w.type='solo' AND t.workspace_id IS NULL;
UPDATE subscriptions t       SET workspace_id = w.id FROM workspaces w WHERE w.owner_user_id = t.user_id        AND w.type='solo' AND t.workspace_id IS NULL;
-- lead_categories.user_id is text; cast for the join.
UPDATE lead_categories t     SET workspace_id = w.id FROM workspaces w WHERE w.owner_user_id = t.user_id::uuid  AND w.type='solo' AND t.workspace_id IS NULL;

-- Scoping indexes for the workspace_id filters the app will use.
CREATE INDEX IF NOT EXISTS idx_posts_ws ON posts (workspace_id);
CREATE INDEX IF NOT EXISTS idx_creator_profile_ws ON creator_profile (workspace_id);
CREATE INDEX IF NOT EXISTS idx_social_accounts_ws ON social_accounts (workspace_id);
CREATE INDEX IF NOT EXISTS idx_content_ideas_ws ON content_ideas (workspace_id);
CREATE INDEX IF NOT EXISTS idx_series_ws ON series (workspace_id);
CREATE INDEX IF NOT EXISTS idx_publish_jobs_ws ON publish_jobs (workspace_id);

-- ----------------------------------------------------------------------------
-- PART 2: membership-based RLS  (APPLY ONLY AFTER THE APP IS WORKSPACE-AWARE)
-- ----------------------------------------------------------------------------
-- Every policy below replaces the existing `user_id = auth.uid()` form with
-- workspace membership. Do NOT run this until the app sets workspace_id on
-- every insert and resolves an active workspace per request, or all writes
-- will fail the WITH CHECK. Helper to keep policies short:
--
--   workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())
--
-- Tables also covered specially:
--   post_distributions: keep the cross-table subquery, but resolve through
--     posts.workspace_id instead of posts.user_id.
--   lead_categories: cast as needed (the column was text historically).
--
-- The full PART 2 policy set is generated alongside the code switch in the
-- workspace-aware execution step, so policies and code ship together.
