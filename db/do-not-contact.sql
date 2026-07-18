-- db/do-not-contact.sql
create table if not exists do_not_contact (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  linkedin_provider_id text,
  linkedin_url text,
  x_handle text,
  email text,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists dnc_workspace on do_not_contact(workspace_id);

-- Workspace-scoped RLS for do_not_contact table
alter table do_not_contact enable row level security;

-- Member policies (workspace_members subquery, same pattern as signals-rls.sql)
do $$ begin
  create policy do_not_contact_member on do_not_contact for all using (
    workspace_id in (select workspace_id from workspace_members where user_id = auth.uid())
  ) with check (
    workspace_id in (select workspace_id from workspace_members where user_id = auth.uid())
  );
exception when duplicate_object then null;
end $$;

-- Project-admin bypass (server/cron paths)
do $$ begin
  create policy do_not_contact_admin on do_not_contact for all to project_admin using (true) with check (true);
exception when duplicate_object then null;
end $$;
