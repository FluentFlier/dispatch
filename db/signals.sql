-- Content OS Signals (GTM module) — workspace-scoped signal engine
-- Apply in order:
--   npx @insforge/cli db query "$(sed '/^--/d' db/signals.sql | tr '\n' ' ')"
--   npx @insforge/cli db query "$(sed '/^--/d' db/signals-composio.sql | tr '\n' ' ')"
--   npx @insforge/cli db query "$(sed '/^--/d' db/signals-rls.sql | tr '\n' ' ')"

-- Tracked X handles / LinkedIn URLs per workspace
create table if not exists signal_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  platform text not null check (platform in ('x', 'linkedin')),
  handle_or_url text not null,
  source_type text not null default 'account'
    check (source_type in ('account', 'company_page', 'person_profile', 'keyword_search')),
  label text,
  enabled boolean not null default true,
  poll_interval_minutes int not null default 30,
  last_polled_at timestamptz,
  cursor_json jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists signal_sources_workspace on signal_sources (workspace_id, enabled);
create unique index if not exists signal_sources_unique
  on signal_sources (workspace_id, platform, handle_or_url);

-- Trigger rules (v1: stored; engine applies in classifier + sync)
create table if not exists signal_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  name text not null,
  platform text check (platform in ('x', 'linkedin', 'any')),
  conditions jsonb not null default '{}',
  action_mode text not null default 'notify_and_draft'
    check (action_mode in ('notify_only', 'notify_and_draft', 'auto_send')),
  channels jsonb not null default '["dashboard"]',
  enabled boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists signal_rules_workspace on signal_rules (workspace_id, enabled);

-- Raw ingested posts (dedupe by external id)
create table if not exists signal_raw_posts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  source_id uuid references signal_sources(id) on delete set null,
  platform text not null check (platform in ('x', 'linkedin')),
  external_post_id text not null,
  author_handle text,
  author_name text,
  content text not null,
  post_url text,
  posted_at timestamptz,
  raw_payload jsonb default '{}',
  created_at timestamptz default now()
);

create unique index if not exists signal_raw_posts_dedupe
  on signal_raw_posts (workspace_id, platform, external_post_id);

-- Classified GTM signals
create table if not exists signal_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  raw_post_id uuid references signal_raw_posts(id) on delete cascade,
  signal_type text not null
    check (signal_type in ('accelerator_join', 'funding_round', 'role_change', 'launch', 'other', 'keyword_match')),
  company_name text,
  person_name text,
  accelerator_name text,
  batch text,
  signal_summary text,
  confidence numeric not null default 0,
  dedupe_key text,
  status text not null default 'pending'
    check (status in ('pending', 'drafted', 'sent', 'dismissed', 'failed')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists signal_events_workspace on signal_events (workspace_id, created_at desc);
create index if not exists signal_events_status on signal_events (workspace_id, status);
create unique index if not exists signal_events_dedupe
  on signal_events (workspace_id, dedupe_key)
  where dedupe_key is not null;

-- Outreach drafts and actions
create table if not exists signal_outreach (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  event_id uuid not null references signal_events(id) on delete cascade,
  channel text not null
    check (channel in ('linkedin_connect', 'linkedin_dm', 'x_dm', 'copy', 'gmail')),
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'sent', 'failed', 'dismissed')),
  draft_text text,
  final_text text,
  template_id text,
  sent_at timestamptz,
  external_message_id text,
  error text,
  target_linkedin_identifier text,
  linkedin_provider_id text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists signal_outreach_event on signal_outreach (event_id);
create unique index if not exists signal_outreach_event_unique on signal_outreach (event_id);

-- Feature flag seed (optional)
insert into feature_flags (name, enabled, description)
values ('signals_engine', true, 'Content OS Signals GTM module')
on conflict (name) do nothing;

-- Per-workspace safety settings (conservative defaults — Unipile provider limits)
create table if not exists signal_safety_settings (
  workspace_id uuid primary key,
  outreach_enabled boolean not null default false,
  auto_send_enabled boolean not null default false,
  dry_run boolean not null default true,
  max_linkedin_invites_per_day int not null default 25,
  max_linkedin_inmail_per_day int not null default 15,
  max_x_dm_per_day int not null default 15,
  max_gmail_per_day int not null default 20,
  max_linkedin_invites_per_week int not null default 80,
  min_seconds_between_sends int not null default 180,
  max_jitter_seconds int not null default 120,
  min_poll_interval_minutes int not null default 30,
  max_sources_per_sync_run int not null default 6,
  delay_between_polls_ms int not null default 15000,
  working_hours_only boolean not null default true,
  working_hours_utc_start int not null default 14,
  working_hours_utc_end int not null default 22,
  updated_at timestamptz default now()
);

-- Audit log for every outreach attempt, block, and poll (ban-risk visibility)
create table if not exists signal_outreach_audit (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  channel text,
  action text not null,
  event_id uuid,
  social_account_id text,
  blocked_reason text,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

create index if not exists signal_outreach_audit_workspace_day
  on signal_outreach_audit (workspace_id, created_at desc);
create index if not exists signal_outreach_audit_action
  on signal_outreach_audit (workspace_id, action, created_at desc);

alter table signal_safety_settings enable row level security;
alter table signal_outreach_audit enable row level security;

do $$ begin
  create policy signal_safety_settings_project_admin
    on signal_safety_settings for all to project_admin using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy signal_outreach_audit_project_admin
    on signal_outreach_audit for all to project_admin using (true) with check (true);
exception when duplicate_object then null;
end $$;
