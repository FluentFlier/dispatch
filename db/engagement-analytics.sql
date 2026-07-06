-- Engagement analytics (imagine import): reactions on own posts + outbound engagement queue
-- Apply: npx @insforge/cli db query "$(cat db/engagement-analytics.sql)"

-- Who reacted to our posts. Comments live in post_comments; reactions are the
-- other half of engagement and feed audience/lead categorization.
create table if not exists post_reactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  post_id uuid not null references posts(id) on delete cascade,
  platform text not null,
  reaction_type text not null, -- LIKE | PRAISE | APPRECIATION | EMPATHY | INTEREST | ENTERTAINMENT
  -- Stable dedupe key: author handle, falling back to name. Kept NOT NULL so the
  -- unique constraint below actually prevents duplicates (NULLs never collide).
  author_key text not null,
  author_name text,
  author_handle text,
  author_headline text,
  author_profile_url text,
  is_company boolean not null default false,
  synced_at timestamptz default now() not null,
  unique(user_id, post_id, author_key, reaction_type)
);

create index if not exists post_reactions_post on post_reactions (post_id, synced_at desc);
create index if not exists post_reactions_user on post_reactions (user_id, synced_at desc);

-- Outbound engagement queue: AI-drafted comments/reactions on OTHER people's
-- posts (watched accounts / signals), approved by the user, then posted by the
-- cron worker with lease-based locking + human-mimicking pacing.
create table if not exists engagement_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  platform text not null default 'linkedin',
  kind text not null default 'comment' check (kind in ('comment','reaction')),
  target_provider_post_id text not null,
  target_post_url text,
  target_author_name text,
  target_post_excerpt text,
  source text not null default 'manual', -- manual | signal
  comment_text text,
  reaction_type text not null default 'like',
  status text not null default 'draft'
    check (status in ('draft','approved','processing','sent','failed','skipped')),
  attempts int not null default 0,
  max_attempts int not null default 3,
  lease_id uuid,
  lease_expires_at timestamptz,
  scheduled_at timestamptz default now() not null,
  sent_at timestamptz,
  provider_result_id text,
  last_error text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists engagement_tasks_user_status on engagement_tasks (user_id, status);
create index if not exists engagement_tasks_due on engagement_tasks (status, scheduled_at);

alter table post_reactions enable row level security;
alter table post_reactions force row level security;
alter table engagement_tasks enable row level security;
alter table engagement_tasks force row level security;

do $$ begin
  create policy post_reactions_select on post_reactions
    for select using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy post_reactions_insert on post_reactions
    for insert with check (user_id = auth.uid());
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy post_reactions_update on post_reactions
    for update using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy post_reactions_delete on post_reactions
    for delete using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy post_reactions_project_admin on post_reactions
    for all to project_admin using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy engagement_tasks_select on engagement_tasks
    for select using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy engagement_tasks_insert on engagement_tasks
    for insert with check (user_id = auth.uid());
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy engagement_tasks_update on engagement_tasks
    for update using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy engagement_tasks_delete on engagement_tasks
    for delete using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy engagement_tasks_project_admin on engagement_tasks
    for all to project_admin using (true) with check (true);
exception when duplicate_object then null;
end $$;

do $$ begin
  create trigger engagement_tasks_updated_at
    before update on engagement_tasks
    for each row execute function update_updated_at();
exception when duplicate_object then null;
end $$;
