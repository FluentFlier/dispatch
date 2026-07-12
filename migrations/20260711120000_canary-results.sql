-- Phase 4 (spec 4.3): daily canary run results. One row per (day, case).
-- Service-role write, admin read via service client (getServiceClient bypasses
-- RLS, so no anon/authenticated policies are needed - mirrors the no-policy
-- service-role-only tables' intent in migrations/20260706225246_admin-ops-tables.sql,
-- style kept lowercase to match that file).

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
-- No anon/authenticated policies: service-role only (writes from the cron,
-- reads from the admin ops page via getServiceClient).
