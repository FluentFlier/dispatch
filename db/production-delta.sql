-- Dispatch production readiness delta (idempotent)

-- social_accounts extensions
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS connection_method text NOT NULL DEFAULT 'oauth';
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'direct';
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS provider_profile_key text;
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS provider_meta jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS health_status text NOT NULL DEFAULT 'unknown';

-- posts extensions
ALTER TABLE posts ADD COLUMN IF NOT EXISTS publish_job_id uuid;

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

-- indexes
CREATE INDEX IF NOT EXISTS posts_scheduled_publish ON posts (scheduled_publish_at) WHERE status != 'posted';
CREATE INDEX IF NOT EXISTS publish_jobs_status_scheduled ON publish_jobs (status, scheduled_for);
CREATE INDEX IF NOT EXISTS publish_jobs_user ON publish_jobs (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS usage_counters_lookup ON usage_counters (user_id, metric, period_key);
