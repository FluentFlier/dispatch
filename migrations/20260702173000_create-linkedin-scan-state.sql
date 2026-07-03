-- LinkedIn scan dedup state (event-capture cost control)
--
-- WHY: scanLinkedInForEvents (the calendar-sync cascade fallback) re-sent the
-- same up-to-25 recent posts to the LLM on every hourly run for any workspace
-- whose calendar produced nothing that hour - an unbounded, unbudgeted cost leak,
-- worst on the quietest calendars. This table records which post ids have already
-- been classified (positive or negative) per workspace, capped to the last 50
-- (MAX_SCANNED_IDS in linkedin-scan.ts), so a post is never reclassified once seen.
--
-- Written only by the service client (calendar-sync cron); read by nothing
-- user-facing, so RLS enabled with zero policies (deny-all) is the correct default
-- here, not a missed migration. Idempotent, safe to re-run.

create table if not exists linkedin_scan_state (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  scanned_post_ids jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

alter table linkedin_scan_state enable row level security;
