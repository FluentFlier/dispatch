-- Creator Brain — per-user memory pages (GBrain-style, InsForge-native)
-- Apply: npx @insforge/cli db query "$(cat db/creator-brain.sql)"

create table if not exists creator_brain_pages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  slug text not null,
  title text not null,
  tags text[] not null default '{}',
  body text not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null,
  unique(user_id, slug)
);

create index if not exists creator_brain_pages_user on creator_brain_pages (user_id, updated_at desc);
create index if not exists creator_brain_pages_tags on creator_brain_pages using gin (tags);

alter table creator_brain_pages enable row level security;
alter table creator_brain_pages force row level security;

do $$ begin
  create policy creator_brain_pages_select on creator_brain_pages
    for select using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy creator_brain_pages_insert on creator_brain_pages
    for insert with check (user_id = auth.uid());
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy creator_brain_pages_update on creator_brain_pages
    for update using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy creator_brain_pages_delete on creator_brain_pages
    for delete using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy creator_brain_pages_project_admin on creator_brain_pages
    for all to project_admin using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create trigger creator_brain_pages_updated_at
    before update on creator_brain_pages
    for each row execute function update_updated_at();
exception when duplicate_object then null;
end $$;
