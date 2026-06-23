-- ============================================================
-- Dispatch -- Database Schema
-- Apply via: insforge db apply --file db/schema.sql
-- ============================================================

-- ============================================================
-- CREATOR PROFILE (per-user settings, pillars, platform config)
-- ============================================================

create table if not exists creator_profile (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  display_name text not null,
  bio text,
  bio_facts text not null default '',
  voice_description text not null default '',
  voice_rules text not null default '',
  content_pillars jsonb not null default '[]'::jsonb,
  platform_config jsonb not null default '{}'::jsonb,
  onboarding_complete boolean not null default false,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

-- ============================================================
-- SERIES (referenced by posts, create first)
-- ============================================================

create table if not exists series (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  description text,
  pillar text not null,
  total_parts int not null default 2,
  created_at timestamptz default now() not null
);

-- ============================================================
-- POSTS
-- ============================================================

create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  title text not null,
  pillar text not null,
  platform text not null check (platform in ('instagram','linkedin','twitter','threads')) default 'instagram',
  status text not null check (status in ('idea','scripted','filmed','edited','posted')) default 'idea',
  script text,
  caption text,
  hashtags text,
  hook text,
  notes text,
  scheduled_date date,
  posted_date date,
  views int,
  likes int,
  saves int,
  comments int,
  shares int,
  follows_gained int,
  voice_match_score int,
  ai_score int,
  voice_evaluation jsonb,
  series_id uuid references series(id) on delete set null,
  series_position int,
  variant_group_id uuid,
  source_platform text,
  scheduled_publish_at timestamptz,
  image_url text,
  publish_job_id uuid,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger posts_updated_at
  before update on posts
  for each row execute function update_updated_at();

-- ============================================================
-- STORY BANK
-- ============================================================

create table if not exists story_bank (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  raw_memory text not null,
  mined_angle text,
  mined_hook text,
  mined_script text,
  mined_caption_line text,
  pillar text,
  used boolean default false not null,
  used_post_id uuid references posts(id) on delete set null,
  created_at timestamptz default now() not null
);

-- ============================================================
-- CONTENT IDEAS
-- ============================================================

create table if not exists content_ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  idea text not null,
  pillar text not null,
  priority text not null check (priority in ('low','medium','high')) default 'medium',
  notes text,
  converted boolean default false not null,
  created_at timestamptz default now() not null
);

-- ============================================================
-- HASHTAG SETS
-- ============================================================

create table if not exists hashtag_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  tags text not null,
  pillar text,
  use_count int default 0 not null,
  created_at timestamptz default now() not null
);

-- ============================================================
-- WEEKLY REVIEWS
-- ============================================================

create table if not exists weekly_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  week_start date not null,
  posts_published int default 0,
  total_views int default 0,
  total_followers_gained int default 0,
  top_post_id uuid references posts(id) on delete set null,
  what_worked text,
  what_to_double_down text,
  what_to_cut text,
  next_week_focus text,
  created_at timestamptz default now() not null
);

-- ============================================================
-- USER SETTINGS
-- ============================================================

create table if not exists user_settings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  key text not null,
  value text not null,
  updated_at timestamptz default now() not null,
  unique(user_id, key)
);

-- ============================================================
-- SOCIAL ACCOUNTS (OAuth-connected platform accounts)
-- ============================================================

create table if not exists social_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  platform text not null check (platform in ('instagram','linkedin','twitter','threads')),
  account_name text,
  account_id text,
  access_token text not null,
  refresh_token text,
  token_expires_at timestamptz,
  connection_method text not null default 'oauth',
  provider text not null default 'direct',
  provider_profile_key text,
  provider_meta jsonb not null default '{}'::jsonb,
  health_status text not null default 'unknown',
  connected_at timestamptz default now() not null,
  unique(user_id, platform)
);

-- ============================================================
-- SUBSCRIPTIONS (Stripe billing)
-- ============================================================

create table if not exists subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  plan text not null default 'free' check (plan in ('free','starter','growth','pro')),
  status text not null default 'inactive' check (status in ('inactive','trialing','active','past_due','canceled')),
  stripe_customer_id text,
  stripe_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create trigger subscriptions_updated_at
  before update on subscriptions
  for each row execute function update_updated_at();

-- ============================================================
-- USAGE COUNTERS (rate limits + plan metering)
-- ============================================================

create table if not exists usage_counters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  metric text not null,
  period_key text not null,
  count int not null default 0,
  updated_at timestamptz default now() not null,
  unique(user_id, metric, period_key)
);

-- ============================================================
-- PUBLISH JOBS (durable queue)
-- ============================================================

create table if not exists publish_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  post_id uuid not null references posts(id) on delete cascade,
  platform text not null,
  status text not null default 'queued' check (status in ('queued','processing','published','failed','dead')),
  idempotency_key text not null,
  scheduled_for timestamptz,
  attempts int not null default 0,
  max_attempts int not null default 3,
  last_error text,
  provider text not null default 'direct',
  provider_post_id text,
  provider_url text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique(idempotency_key)
);

create trigger publish_jobs_updated_at
  before update on publish_jobs
  for each row execute function update_updated_at();

-- ============================================================
-- AYRSHARE PROFILES (one profile key per Dispatch user)
-- ============================================================

create table if not exists ayrshare_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique,
  profile_key text not null,
  title text,
  created_at timestamptz default now() not null
);

-- ============================================================
-- CREATOR BRAIN (per-user memory pages, GBrain-style on InsForge)
-- ============================================================

create table if not exists creator_brain_pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  slug text not null,
  title text not null,
  tags text[] not null default '{}',
  body text not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique(user_id, slug)
);

create trigger creator_brain_pages_updated_at
  before update on creator_brain_pages
  for each row execute function update_updated_at();

-- ============================================================
-- INDEXES
-- ============================================================

create index if not exists posts_user_status on posts (user_id, status);
create index if not exists posts_user_pillar on posts (user_id, pillar);
create index if not exists posts_scheduled_date on posts (user_id, scheduled_date);
create index if not exists posts_scheduled_publish on posts (scheduled_publish_at) where status != 'posted';
create index if not exists story_bank_user_used on story_bank (user_id, used);
create index if not exists content_ideas_user_priority on content_ideas (user_id, priority, created_at desc);
create index if not exists user_settings_lookup on user_settings (user_id, key);
create index if not exists social_accounts_user on social_accounts (user_id);
create index if not exists publish_jobs_status_scheduled on publish_jobs (status, scheduled_for);
create index if not exists publish_jobs_user on publish_jobs (user_id, created_at desc);
create index if not exists usage_counters_lookup on usage_counters (user_id, metric, period_key);
create index if not exists creator_brain_pages_user on creator_brain_pages (user_id, updated_at desc);

-- Index for UI queries: jobs by user + status (no index existed for this pattern)
create index if not exists publish_jobs_user_status
  on publish_jobs (user_id, status, created_at desc);

-- ============================================================
-- ATOMIC USAGE INCREMENT (Phase 0 — race condition fix)
-- Replaces the SELECT-then-UPDATE pattern in src/lib/usage.ts.
-- Called via client.database.rpc('increment_usage_counter', {...}).
-- ============================================================

create or replace function increment_usage_counter(
  p_user_id uuid,
  p_metric  text,
  p_period_key text,
  p_amount  int default 1
) returns void
language sql
as $$
  insert into usage_counters (user_id, metric, period_key, count, updated_at)
  values (p_user_id, p_metric, p_period_key, p_amount, now())
  on conflict (user_id, metric, period_key)
  do update set
    count      = usage_counters.count + excluded.count,
    updated_at = now();
$$;
