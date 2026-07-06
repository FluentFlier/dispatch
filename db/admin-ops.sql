-- Admin ops tables: audit log, cron history, Stripe webhook log.
-- Apply via InsForge MCP or: npx @insforge/cli db query "$(tr '\n' ' ' < db/admin-ops.sql)"

create table if not exists admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_email text not null,
  actor_user_id uuid,
  action text not null,
  target_type text,
  target_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_log_created on admin_audit_log (created_at desc);
create index if not exists admin_audit_log_action on admin_audit_log (action, created_at desc);

create table if not exists cron_run_log (
  id uuid primary key default gen_random_uuid(),
  job_name text not null,
  status text not null check (status in ('ok', 'error', 'partial')),
  duration_ms int,
  summary jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists cron_run_log_created on cron_run_log (created_at desc);
create index if not exists cron_run_log_job on cron_run_log (job_name, created_at desc);

create table if not exists stripe_webhook_log (
  id uuid primary key default gen_random_uuid(),
  event_id text,
  event_type text not null,
  status text not null check (status in ('ok', 'error', 'ignored')),
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists stripe_webhook_log_created on stripe_webhook_log (created_at desc);

-- Service role only (project_admin bypass in live DB)
alter table admin_audit_log enable row level security;
alter table cron_run_log enable row level security;
alter table stripe_webhook_log enable row level security;

do $$ begin
  create policy admin_audit_log_admin on admin_audit_log for all to project_admin using (true) with check (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy cron_run_log_admin on cron_run_log for all to project_admin using (true) with check (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy stripe_webhook_log_admin on stripe_webhook_log for all to project_admin using (true) with check (true);
exception when duplicate_object then null; end $$;
