-- Phase 4 (spec 4.3): daily canary run results. One row per (day, case).
-- Service-role write (cron via getServiceClient, RLS-bypassing); admin-only
-- read. Grants the same project_admin read/write policy the sibling admin
-- tables use (pipeline_events, admin_audit_log / cron_run_log) so an admin
-- dashboard reading through a project_admin client does not silently get zero
-- rows. Style kept lowercase to match those files.

create table if not exists canary_results (
  id uuid primary key default gen_random_uuid(),
  run_date date not null,
  case_id text not null,
  hard_pass boolean not null,
  judge_pass boolean not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_date, case_id)
);

create index if not exists idx_canary_results_run_date on canary_results (run_date);

alter table canary_results enable row level security;

do $$ begin
  create policy canary_results_admin on canary_results for all to project_admin using (true) with check (true);
exception when duplicate_object then null; end $$;
