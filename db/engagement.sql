-- Engagement inbox: synced comments + reply queue (Outstand-backed)
-- Apply: npx @insforge/cli db query "$(cat db/engagement.sql)"

create table if not exists post_comments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  post_id uuid not null references posts(id) on delete cascade,
  platform text not null,
  provider_comment_id text not null,
  author_name text,
  author_handle text,
  author_headline text,
  comment_text text not null,
  commented_at timestamptz,
  parent_comment_id uuid references post_comments(id) on delete cascade,
  synced_at timestamptz default now() not null,
  unique(user_id, provider_comment_id)
);

create table if not exists comment_reply_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  post_comment_id uuid not null references post_comments(id) on delete cascade,
  draft_reply text not null,
  status text not null default 'draft' check (status in ('draft','approved','sent','skipped','failed')),
  voice_match_score int,
  evaluation jsonb,
  sent_at timestamptz,
  provider_reply_id text,
  last_error text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists post_comments_post on post_comments (post_id, commented_at desc);
create index if not exists post_comments_user_unreplied on post_comments (user_id, synced_at desc);
create index if not exists comment_reply_queue_status on comment_reply_queue (user_id, status);

create trigger comment_reply_queue_updated_at
  before update on comment_reply_queue
  for each row execute function update_updated_at();
