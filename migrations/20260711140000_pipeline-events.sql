-- Pipeline degradation events (idempotent).
--
-- WHY: every silent-fallback branch in the content pipeline (compact-mode
-- routing, static-hook fallback, targeted revise, escalation, judge parse
-- errors, shipping a draft that still fails a hard check, provider
-- failover, stage-contract violations) previously had no observable trace.
-- "What % of yesterday's generations ran compact mode and why" could not be
-- answered with a query. This table is that answer. Written by the service
-- client only (src/lib/content-pipeline/events.ts), fire-and-forget from the
-- generation path - inserts never block or fail a generation.

create table if not exists pipeline_events (
  id uuid primary key default gen_random_uuid(),
  request_id text not null,
  user_id uuid,
  event text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists pipeline_events_created on pipeline_events (created_at desc);
create index if not exists pipeline_events_request on pipeline_events (request_id);
create index if not exists pipeline_events_event on pipeline_events (event, created_at desc);

alter table pipeline_events enable row level security;

-- Service-role write (RLS-bypassing client from events.ts); admin-only read,
-- mirroring the admin_audit_log / cron_run_log pattern in
-- migrations/20260706180000_admin-ops.sql.
do $$ begin
  create policy pipeline_events_admin on pipeline_events for all to project_admin using (true) with check (true);
exception when duplicate_object then null; end $$;
