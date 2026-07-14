-- Named ICP "agendas" for the Directory Lead Engine.
--
-- This table was originally provisioned out-of-band, so it existed in prod but
-- had no reproducible definition in the repo and no RLS policy (unlike every
-- sibling signals table). This migration makes it reproducible: it creates the
-- table for fresh environments and back-fills the 7 "agenda" columns the app
-- reads/writes (goal_type, target_personas, pitch_angle, tone_rules,
-- daily_connect_limit, daily_comment_limit, sources) onto any existing install,
-- then enables workspace-scoped RLS to match signals-leads-rls.sql.
--
-- Apply after signals-leads.sql. Idempotent — safe to run repeatedly.

create table if not exists signal_icp_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  name text not null,
  description text,
  verticals jsonb not null default '[]',
  keywords jsonb not null default '[]',
  is_active boolean not null default false,
  goal_type text not null default 'networking',
  target_personas jsonb not null default '[]',
  pitch_angle text,
  tone_rules text,
  daily_connect_limit int not null default 5,
  daily_comment_limit int not null default 5,
  sources jsonb not null default '["engagers","directory","signals"]',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Back-fill the agenda columns onto an existing (out-of-band) table.
alter table signal_icp_profiles add column if not exists goal_type text not null default 'networking';
alter table signal_icp_profiles add column if not exists target_personas jsonb not null default '[]';
alter table signal_icp_profiles add column if not exists pitch_angle text;
alter table signal_icp_profiles add column if not exists tone_rules text;
alter table signal_icp_profiles add column if not exists daily_connect_limit int not null default 5;
alter table signal_icp_profiles add column if not exists daily_comment_limit int not null default 5;
alter table signal_icp_profiles add column if not exists sources jsonb not null default '["engagers","directory","signals"]';

create index if not exists signal_icp_profiles_workspace_idx on signal_icp_profiles (workspace_id);
-- At most one active agenda per workspace (matches deactivate-others-on-activate logic).
create unique index if not exists signal_icp_profiles_one_active_idx
  on signal_icp_profiles (workspace_id) where is_active;

-- --- Row level security (workspace_members subquery, same pattern as signals-leads-rls.sql) ---
alter table signal_icp_profiles enable row level security;

do $$ begin
  create policy signal_icp_profiles_member on signal_icp_profiles for all using (
    workspace_id in (select workspace_id from workspace_members where user_id = auth.uid())
  ) with check (
    workspace_id in (select workspace_id from workspace_members where user_id = auth.uid())
  );
exception when duplicate_object then null;
end $$;

-- Project-admin bypass (server/cron paths).
do $$ begin
  create policy signal_icp_profiles_admin on signal_icp_profiles for all to project_admin using (true) with check (true);
exception when duplicate_object then null;
end $$;
