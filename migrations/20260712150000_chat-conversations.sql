-- Write-chat conversation history (idempotent).
--
-- WHY: the Write chat (ScriptGenerator) kept its message history only in
-- sessionStorage - one implicit conversation, silently lost when the browser
-- session ends, with no way to revisit an earlier draft. This table gives
-- every conversation a durable server-side row (messages as jsonb, one row
-- per conversation) so users get a history list, resumable chats, and
-- recoverable drafts. Mirrors the event_captures user-scoped RLS pattern.

create table if not exists chat_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  workspace_id uuid,
  title text not null default 'Untitled chat',
  platform text,
  pillar text,
  messages jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chat_conversations_user_updated
  on chat_conversations (user_id, updated_at desc);

alter table chat_conversations enable row level security;

drop policy if exists chat_conversations_select on chat_conversations;
create policy chat_conversations_select on chat_conversations
  for select to public using (user_id = auth.uid());

drop policy if exists chat_conversations_insert on chat_conversations;
create policy chat_conversations_insert on chat_conversations
  for insert to public with check (user_id = auth.uid());

drop policy if exists chat_conversations_update on chat_conversations;
create policy chat_conversations_update on chat_conversations
  for update to public using (user_id = auth.uid());

drop policy if exists chat_conversations_delete on chat_conversations;
create policy chat_conversations_delete on chat_conversations
  for delete to public using (user_id = auth.uid());
