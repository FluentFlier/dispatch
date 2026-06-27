-- Dispatch production readiness delta (idempotent)

-- creator_profile: bio column missing from InsForge schema cache on older deployments
ALTER TABLE creator_profile ADD COLUMN IF NOT EXISTS bio text;

-- social_accounts extensions
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS connection_method text NOT NULL DEFAULT 'oauth';
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'direct';
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS provider_profile_key text;
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS provider_meta jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS health_status text NOT NULL DEFAULT 'unknown';
-- Unipile integration: stores the Unipile-internal account ID used for publishing/reading.
-- access_token becomes optional for Unipile accounts (Unipile manages auth internally).
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS unipile_account_id text;
ALTER TABLE social_accounts ALTER COLUMN access_token SET DEFAULT '';

ALTER TABLE social_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE social_accounts FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY social_accounts_select ON social_accounts
    FOR SELECT USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY social_accounts_insert ON social_accounts
    FOR INSERT WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY social_accounts_update ON social_accounts
    FOR UPDATE USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY social_accounts_delete ON social_accounts
    FOR DELETE USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY social_accounts_project_admin ON social_accounts
    FOR ALL TO project_admin USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- posts extensions
ALTER TABLE posts ADD COLUMN IF NOT EXISTS publish_job_id uuid;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS voice_match_score int;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS ai_score int;
ALTER TABLE posts ADD COLUMN IF NOT EXISTS voice_evaluation jsonb;

-- subscriptions
CREATE TABLE IF NOT EXISTS subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  plan text NOT NULL DEFAULT 'free' CHECK (plan IN ('free','starter','growth','pro')),
  status text NOT NULL DEFAULT 'inactive' CHECK (status IN ('inactive','trialing','active','past_due','canceled')),
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

-- usage_counters
CREATE TABLE IF NOT EXISTS usage_counters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  metric text NOT NULL,
  period_key text NOT NULL,
  count int NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(user_id, metric, period_key)
);

-- publish_jobs
CREATE TABLE IF NOT EXISTS publish_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  platform text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','published','failed','dead')),
  idempotency_key text NOT NULL,
  scheduled_for timestamptz,
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 3,
  last_error text,
  provider text NOT NULL DEFAULT 'direct',
  provider_post_id text,
  provider_url text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(idempotency_key)
);

-- ayrshare_profiles
CREATE TABLE IF NOT EXISTS ayrshare_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  profile_key text NOT NULL,
  title text,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- triggers (skip if exists)
DO $$ BEGIN
  CREATE TRIGGER subscriptions_updated_at
    BEFORE UPDATE ON subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER publish_jobs_updated_at
    BEFORE UPDATE ON publish_jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- workspaces: prevent duplicate solo workspaces per user (race condition on concurrent logins)
CREATE UNIQUE INDEX IF NOT EXISTS workspaces_unique_solo
  ON workspaces (owner_user_id)
  WHERE type = 'solo';

-- indexes
CREATE INDEX IF NOT EXISTS posts_scheduled_publish ON posts (scheduled_publish_at) WHERE status != 'posted';
CREATE INDEX IF NOT EXISTS publish_jobs_status_scheduled ON publish_jobs (status, scheduled_for);
CREATE INDEX IF NOT EXISTS publish_jobs_user ON publish_jobs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_counters_lookup ON usage_counters (user_id, metric, period_key);

-- engagement inbox (comments + reply queue)
CREATE TABLE IF NOT EXISTS post_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  platform text NOT NULL,
  provider_comment_id text NOT NULL,
  author_name text,
  author_handle text,
  author_headline text,
  comment_text text NOT NULL,
  commented_at timestamptz,
  parent_comment_id uuid REFERENCES post_comments(id) ON DELETE CASCADE,
  synced_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(user_id, provider_comment_id)
);

CREATE TABLE IF NOT EXISTS comment_reply_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  post_comment_id uuid NOT NULL REFERENCES post_comments(id) ON DELETE CASCADE,
  draft_reply text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','sent','skipped','failed')),
  voice_match_score int,
  evaluation jsonb,
  sent_at timestamptz,
  provider_reply_id text,
  last_error text,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS post_comments_post ON post_comments (post_id, commented_at DESC);
CREATE INDEX IF NOT EXISTS post_comments_user_unreplied ON post_comments (user_id, synced_at DESC);
CREATE INDEX IF NOT EXISTS comment_reply_queue_status ON comment_reply_queue (user_id, status);

ALTER TABLE post_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE post_comments FORCE ROW LEVEL SECURITY;
ALTER TABLE comment_reply_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE comment_reply_queue FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY post_comments_select ON post_comments
    FOR SELECT USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY post_comments_insert ON post_comments
    FOR INSERT WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY post_comments_update ON post_comments
    FOR UPDATE USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY post_comments_delete ON post_comments
    FOR DELETE USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY post_comments_project_admin ON post_comments
    FOR ALL TO project_admin USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY comment_reply_queue_select ON comment_reply_queue
    FOR SELECT USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY comment_reply_queue_insert ON comment_reply_queue
    FOR INSERT WITH CHECK (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY comment_reply_queue_update ON comment_reply_queue
    FOR UPDATE USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY comment_reply_queue_delete ON comment_reply_queue
    FOR DELETE USING (user_id = auth.uid());
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY comment_reply_queue_project_admin ON comment_reply_queue
    FOR ALL TO project_admin USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TRIGGER comment_reply_queue_updated_at
    BEFORE UPDATE ON comment_reply_queue
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
