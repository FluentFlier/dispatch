-- Workspace-scoped RLS for Directory Lead Engine tables (apply after signals-leads.sql)

alter table signal_leads enable row level security;
alter table signal_lead_contacts enable row level security;
alter table signal_directory_settings enable row level security;
alter table signal_lead_events enable row level security;
alter table signal_followed_companies enable row level security;

-- --- Member policies (workspace_members subquery, same pattern as signals-rls.sql) ---
do $$ begin
  create policy signal_leads_member on signal_leads for all using (
    workspace_id in (select workspace_id from workspace_members where user_id = auth.uid())
  ) with check (
    workspace_id in (select workspace_id from workspace_members where user_id = auth.uid())
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy signal_lead_contacts_member on signal_lead_contacts for all using (
    workspace_id in (select workspace_id from workspace_members where user_id = auth.uid())
  ) with check (
    workspace_id in (select workspace_id from workspace_members where user_id = auth.uid())
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy signal_directory_settings_member on signal_directory_settings for all using (
    workspace_id in (select workspace_id from workspace_members where user_id = auth.uid())
  ) with check (
    workspace_id in (select workspace_id from workspace_members where user_id = auth.uid())
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy signal_lead_events_member on signal_lead_events for all using (
    workspace_id in (select workspace_id from workspace_members where user_id = auth.uid())
  ) with check (
    workspace_id in (select workspace_id from workspace_members where user_id = auth.uid())
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy signal_followed_companies_member on signal_followed_companies for all using (
    workspace_id in (select workspace_id from workspace_members where user_id = auth.uid())
  ) with check (
    workspace_id in (select workspace_id from workspace_members where user_id = auth.uid())
  );
exception when duplicate_object then null;
end $$;

-- --- Project-admin bypass (server/cron paths) ---
do $$ begin
  create policy signal_leads_admin on signal_leads for all to project_admin using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy signal_lead_contacts_admin on signal_lead_contacts for all to project_admin using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy signal_directory_settings_admin on signal_directory_settings for all to project_admin using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy signal_lead_events_admin on signal_lead_events for all to project_admin using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy signal_followed_companies_admin on signal_followed_companies for all to project_admin using (true) with check (true);
exception when duplicate_object then null;
end $$;
