-- Agent API keys - per-user tokens for headless agents (Claude, Cursor, cron scripts).
-- Apply via: npx @insforge/cli db query "$(cat db/agent-api-keys.sql)"

create table if not exists agent_api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  name text not null,
  key_prefix text not null,
  key_hash text not null unique,
  scopes text[] not null default array['read','write']::text[],
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz default now() not null
);

create index if not exists agent_api_keys_user on agent_api_keys (user_id);
create index if not exists agent_api_keys_hash on agent_api_keys (key_hash) where revoked_at is null;

alter table agent_api_keys enable row level security;
alter table agent_api_keys force row level security;

do $$ begin
  create policy agent_api_keys_select on agent_api_keys
    for select using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy agent_api_keys_insert on agent_api_keys
    for insert with check (user_id = auth.uid());
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy agent_api_keys_update on agent_api_keys
    for update using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy agent_api_keys_delete on agent_api_keys
    for delete using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy agent_api_keys_project_admin on agent_api_keys
    for all to project_admin using (true) with check (true);
exception when duplicate_object then null;
end $$;
