-- Hook Intelligence + Social Listening (persistent storage in InsForge)
-- To apply (run with service role key on your real InsForge project):
-- npx @insforge/cli db query "$(cat db/hooks-intelligence.sql)"
-- Then also apply production-delta.sql for voice/engagement/brain columns if not already done.
--
-- This enables real lead_categories persistence, snapshots, research_posts, etc. for the consumer analytics value.

create table if not exists hook_examples (
  id text primary key,
  text text not null,
  author text not null,
  platform text not null default 'x',
  verticals text[] not null default '{}',
  engagement jsonb,
  score_total int,
  score_details jsonb,
  mined_at timestamptz default now(),
  last_reinforced_at timestamptz,
  performance_delta numeric default 0,
  created_at timestamptz default now()
);

create index if not exists hook_examples_author on hook_examples (author);
create index if not exists hook_examples_verticals on hook_examples using gin (verticals);
create index if not exists hook_examples_score on hook_examples (score_total desc);

-- For social listening runs / audit
create table if not exists social_listening_runs (
  id uuid primary key default gen_random_uuid(),
  accounts_checked int,
  new_hooks_found int,
  run_at timestamptz default now()
);

-- Imagine-style: categorized engagement for actionable (not vanity) analytics + lead gen proof
create table if not exists lead_categories (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  post_id text,
  category text not null, -- ICP | Community | Potential Lead | Other
  engager_handle text,
  reason text,
  created_at timestamptz default now()
);
create index if not exists lead_categories_user on lead_categories (user_id, created_at desc);

alter table lead_categories enable row level security;

do $$ begin
  create policy lead_categories_select
    on lead_categories for select
    using (user_id::uuid = auth.uid());
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy lead_categories_insert
    on lead_categories for insert
    with check (user_id::uuid = auth.uid());
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy lead_categories_delete
    on lead_categories for delete
    using (user_id::uuid = auth.uid());
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy lead_categories_project_admin
    on lead_categories for all
    to project_admin
    using (true)
    with check (true);
exception when duplicate_object then null;
end $$;

-- Time-series snapshots for attribution (what mining / model version produced what performance)
create table if not exists analytics_snapshots (
  id uuid primary key default gen_random_uuid(),
  org_id text,
  snapshot_date date default current_date,
  metric text, -- e.g. 'hook_performance', 'leads_generated', 'voice_fidelity'
  value numeric,
  metadata jsonb,
  created_at timestamptz default now()
);

-- Raw research posts (for deeper RAG / future training)
create table if not exists research_posts (
  id text primary key,
  text text,
  author text,
  platform text,
  url text,
  engagement jsonb,
  verticals text[],
  mined_at timestamptz default now()
);

-- Rich usage/audit events emitted by the intelligence usage tracker.
create table if not exists usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz default now() not null
);

create index if not exists usage_events_user_created on usage_events (user_id, created_at desc);

alter table usage_events enable row level security;

do $$ begin
  create policy usage_events_select
    on usage_events for select
    using (user_id = auth.uid());
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy usage_events_insert
    on usage_events for insert
    with check (user_id = auth.uid());
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy usage_events_project_admin
    on usage_events for all
    to project_admin
    using (true)
    with check (true);
exception when duplicate_object then null;
end $$;
