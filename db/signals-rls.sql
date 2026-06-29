-- Workspace-scoped RLS for Signals tables (apply after signals.sql + signals-composio.sql)

alter table signal_sources enable row level security;
alter table signal_events enable row level security;
alter table signal_raw_posts enable row level security;
alter table signal_outreach enable row level security;
alter table signal_integrations enable row level security;

do $$ begin
  create policy signal_sources_member on signal_sources for all using (
    workspace_id in (select workspace_id from workspace_members where user_id = auth.uid())
  ) with check (
    workspace_id in (select workspace_id from workspace_members where user_id = auth.uid())
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy signal_events_member on signal_events for all using (
    workspace_id in (select workspace_id from workspace_members where user_id = auth.uid())
  ) with check (
    workspace_id in (select workspace_id from workspace_members where user_id = auth.uid())
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy signal_raw_posts_member on signal_raw_posts for all using (
    workspace_id in (select workspace_id from workspace_members where user_id = auth.uid())
  ) with check (
    workspace_id in (select workspace_id from workspace_members where user_id = auth.uid())
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy signal_outreach_member on signal_outreach for all using (
    workspace_id in (select workspace_id from workspace_members where user_id = auth.uid())
  ) with check (
    workspace_id in (select workspace_id from workspace_members where user_id = auth.uid())
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy signal_integrations_member on signal_integrations for all using (
    workspace_id in (select workspace_id from workspace_members where user_id = auth.uid())
  ) with check (
    workspace_id in (select workspace_id from workspace_members where user_id = auth.uid())
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy signal_safety_settings_member on signal_safety_settings for all using (
    workspace_id in (select workspace_id from workspace_members where user_id = auth.uid())
  ) with check (
    workspace_id in (select workspace_id from workspace_members where user_id = auth.uid())
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy signal_outreach_audit_member on signal_outreach_audit for all using (
    workspace_id in (select workspace_id from workspace_members where user_id = auth.uid())
  ) with check (
    workspace_id in (select workspace_id from workspace_members where user_id = auth.uid())
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy signal_sources_admin on signal_sources for all to project_admin using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy signal_events_admin on signal_events for all to project_admin using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy signal_raw_posts_admin on signal_raw_posts for all to project_admin using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy signal_outreach_admin on signal_outreach for all to project_admin using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy signal_integrations_admin on signal_integrations for all to project_admin using (true) with check (true);
exception when duplicate_object then null;
end $$;
