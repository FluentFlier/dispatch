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

create trigger creator_brain_pages_updated_at
  before update on creator_brain_pages
  for each row execute function update_updated_at();
