-- Warm contacts: people who reacted to your posts (UseSocial-style social graph).
-- Apply via: npx @insforge/cli db query "$(cat db/warm-contacts.sql)"

create table if not exists warm_contacts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  workspace_id uuid,
  platform text not null default 'linkedin',
  provider_profile_id text,
  public_identifier text,
  display_name text,
  headline text,
  profile_url text,
  reaction_type text,
  source_post_id uuid,
  source_post_title text,
  category text not null default 'Other',
  status text not null default 'new' check (status in ('new','drafted','sent','dismissed')),
  outreach_draft text,
  outreach_channel text,
  last_synced_at timestamptz default now() not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create unique index if not exists warm_contacts_dedupe
  on warm_contacts (user_id, platform, coalesce(provider_profile_id, public_identifier, id::text));

create index if not exists warm_contacts_user on warm_contacts (user_id, status);
create index if not exists warm_contacts_workspace on warm_contacts (workspace_id);

alter table warm_contacts enable row level security;
alter table warm_contacts force row level security;

do $$ begin
  create policy warm_contacts_select on warm_contacts
    for select using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy warm_contacts_insert on warm_contacts
    for insert with check (user_id = auth.uid());
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy warm_contacts_update on warm_contacts
    for update using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy warm_contacts_delete on warm_contacts
    for delete using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy warm_contacts_project_admin on warm_contacts
    for all to project_admin using (true) with check (true);
exception when duplicate_object then null;
end $$;

create table if not exists social_graph_read_cache (
  id uuid primary key default gen_random_uuid(),
  cache_key text not null unique,
  payload jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz default now() not null
);

create index if not exists social_graph_read_cache_expires on social_graph_read_cache (expires_at);
