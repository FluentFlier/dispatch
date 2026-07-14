-- ============================================================
-- GENERATION CONTEXT CACHE
-- Persists the assembled context bundle for one generation thread so
-- regenerations reuse it (fast light-path drafts) without re-running the
-- expensive voice-context assembly (brain + Supermemory + story-bank reads) or
-- the full pipeline every time. regen_count tracks how many light regens have
-- run; past a threshold the caller reloads the full pipeline and resets it.
-- Survives across sessions (DB-backed), so a later session can regen quickly.
-- ============================================================

create table if not exists generation_context (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  workspace_id uuid,
  platform text,
  content_type text default 'post',
  -- The original brief/aim - so a regen never drifts from what was asked.
  user_prompt text not null,
  -- Fully-assembled context additions (voice evidence, facts, memory) - the
  -- expensive-to-rebuild block we cache.
  context_additions text,
  profile_snapshot jsonb,
  vocabulary jsonb,
  structural jsonb,
  mentions jsonb,
  last_draft text,
  regen_count int not null default 0,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

create index if not exists generation_context_user on generation_context (user_id);

do $$
begin
  if exists (select 1 from pg_proc where proname = 'update_updated_at') then
    drop trigger if exists generation_context_updated_at on generation_context;
    create trigger generation_context_updated_at
      before update on generation_context
      for each row execute function update_updated_at();
  end if;
end $$;

-- RLS: a user sees only their own bundles. Aligns with the user_id-based RLS
-- used across the app pending the workspace_id migration.
alter table generation_context enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where tablename = 'generation_context' and policyname = 'generation_context_owner'
  ) then
    create policy generation_context_owner on generation_context
      for all
      using (user_id = auth.uid())
      with check (user_id = auth.uid());
  end if;
end $$;
