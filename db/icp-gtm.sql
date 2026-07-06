-- ICP-driven GTM: natural-language ICP description + lead development notes.
-- Apply after signals-leads.sql:
--   npx @insforge/cli db query "$(sed '/^--/d' db/icp-gtm.sql | tr '\n' ' ')"

alter table signal_directory_settings
  add column if not exists icp_description text;

create table if not exists signal_lead_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  lead_id uuid not null references signal_leads(id) on delete cascade,
  user_id uuid not null,
  body text not null,
  created_at timestamptz default now()
);

create index if not exists signal_lead_notes_lead on signal_lead_notes (lead_id, created_at desc);
create index if not exists signal_lead_notes_workspace on signal_lead_notes (workspace_id);

alter table signal_lead_notes enable row level security;
alter table signal_lead_notes force row level security;

do $$ begin
  create policy signal_lead_notes_member on signal_lead_notes for all using (
    workspace_id in (
      select wm.workspace_id from workspace_members wm where wm.user_id = auth.uid()
    )
  ) with check (
    workspace_id in (
      select wm.workspace_id from workspace_members wm where wm.user_id = auth.uid()
    )
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy signal_lead_notes_admin on signal_lead_notes for all to project_admin using (true) with check (true);
exception when duplicate_object then null;
end $$;
