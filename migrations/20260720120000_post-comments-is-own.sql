-- Mark comments written by the account owner.
--
-- WHY: reply state was derived purely from comment_reply_queue, a table only
-- this app writes. A creator who answered a comment natively on LinkedIn still
-- saw "Needs a reply" forever, because nothing recorded that the answer exists.
-- The comment sync now fetches each thread's replies and knows which author is
-- the account owner; this column is where that verdict lands.

alter table post_comments
  add column if not exists is_own boolean not null default false;

-- The inbox asks "does this comment have an owner-authored child?", so the
-- lookup is by parent.
create index if not exists post_comments_parent_own_idx
  on post_comments (parent_comment_id)
  where is_own;
