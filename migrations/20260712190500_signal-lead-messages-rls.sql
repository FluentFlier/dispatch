alter table signal_lead_messages enable row level security;

do $$ begin
  create policy signal_lead_messages_member on signal_lead_messages for all using (
    workspace_id in (select workspace_id from workspace_members where user_id = auth.uid())
  ) with check (
    workspace_id in (select workspace_id from workspace_members where user_id = auth.uid())
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy signal_lead_messages_admin on signal_lead_messages for all to project_admin using (true) with check (true);
exception when duplicate_object then null;
end $$;
