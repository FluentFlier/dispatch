-- Content OS Signals — Directory Lead Engine (Phase 0 foundations)
-- Company-centric "Lead" flow layered onto the post-centric Signal flow.
-- Apply after signals.sql + signals-composio.sql + signals-rls.sql, then apply signals-leads-rls.sql.
--   npx @insforge/cli db query "$(sed '/^--/d' db/signals-leads.sql | tr '\n' ' ')"
--   npx @insforge/cli db query "$(sed '/^--/d' db/signals-leads-rls.sql | tr '\n' ' ')"

-- --- Leads: one row per company surfaced from a startup directory ---
create table if not exists signal_leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  source text not null
    check (source in ('yc_directory', 'yc_launches', 'product_hunt', 'manual')),
  external_id text,                      -- stable per-directory id (YC slug); null for manual
  company_name text not null,
  tagline text,
  website text,
  domain text,                           -- normalized website host; stable identity anchor
  batch text,
  tags jsonb not null default '[]',
  intent_flags jsonb not null default '{}',   -- { hiring, raised, seeking_investors, seeking_tools }
  source_fact jsonb not null default '{}',    -- raw scraped claim the draft asserts (batch/tagline)
  name_history jsonb not null default '[]',   -- prior company_name values (rename trail)
  fit_score numeric not null default 0,
  rank_score numeric not null default 0,
  contact_status text not null default 'unresolved'
    check (contact_status in ('unresolved', 'resolved', 'no_contact')),
  lead_status text not null default 'new'
    check (lead_status in ('new', 'drafted', 'approved', 'sent', 'dismissed', 'resurfaced')),
  first_seen_at timestamptz default now(),
  last_seen_at timestamptz default now(),
  digest_date date,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Dedupe on the stable anchor (source + external_id), not the mutable name.
create unique index if not exists signal_leads_source_external
  on signal_leads (workspace_id, source, external_id)
  where external_id is not null;
create index if not exists signal_leads_digest
  on signal_leads (workspace_id, digest_date, rank_score desc);
create index if not exists signal_leads_status
  on signal_leads (workspace_id, lead_status);
create index if not exists signal_leads_domain
  on signal_leads (workspace_id, domain);

-- --- Lead contacts: resolved founder(s) for a lead ---
create table if not exists signal_lead_contacts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references signal_leads(id) on delete cascade,
  workspace_id uuid not null,
  name text,
  role text,
  linkedin_url text,
  x_handle text,
  email text,
  provider_id text,                       -- Unipile provider id resolved at validate time
  resolution_source text
    check (resolution_source in ('scraped', 'enriched', 'manual')),
  enriched_via text,                      -- apify | tinyfish | unipile (when enriched)
  is_primary boolean not null default false,
  created_at timestamptz default now()
);

create index if not exists signal_lead_contacts_lead on signal_lead_contacts (lead_id);

-- --- Per-workspace directory + digest configuration ---
create table if not exists signal_directory_settings (
  workspace_id uuid primary key,
  enabled_sources jsonb not null default '["yc_directory"]',
  icp_verticals jsonb not null default '[]',
  icp_keywords jsonb not null default '[]',
  recency_window text not null default 'current_batch',
  digest_run_hour_local int not null default 6,
  digest_timezone text,                   -- overrides workspace timezone when set
  digest_channels jsonb not null default '{"today":true,"slack":false,"email":false}',
  digest_top_n int not null default 15,
  digest_delivered_at timestamptz,        -- idempotency: last successful digest push
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- --- Lead lifecycle audit (scrape/score/rename/reactivation) — NOT the outreach audit ---
create table if not exists signal_lead_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  lead_id uuid references signal_leads(id) on delete cascade,
  event_type text not null
    check (event_type in ('scraped', 'new', 'rescored', 'reactivated',
                          'resolved', 'unresolved', 'renamed', 'pivoted', 'merged')),
  detail jsonb not null default '{}',
  created_at timestamptz default now()
);

create index if not exists signal_lead_events_lead on signal_lead_events (lead_id, created_at desc);
create index if not exists signal_lead_events_workspace on signal_lead_events (workspace_id, created_at desc);

-- --- Follow-companies watchlist (first-class input; reactivation source) ---
create table if not exists signal_followed_companies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  company_name text not null,
  domain text,
  external_id text,
  added_by_user_id uuid,
  created_at timestamptz default now()
);

-- Identity anchored on domain (or name when no domain) — can't follow the same company twice.
create unique index if not exists signal_followed_companies_unique
  on signal_followed_companies (workspace_id, lower(coalesce(domain, company_name)));

-- --- Alter existing signal_outreach to carry lead_id alongside event_id ---
alter table signal_outreach alter column event_id drop not null;
alter table signal_outreach add column if not exists lead_id uuid references signal_leads(id) on delete cascade;

do $$ begin
  alter table signal_outreach
    add constraint signal_outreach_event_xor_lead
    check ((event_id is not null) <> (lead_id is not null));
exception when duplicate_object then null;
end $$;

create unique index if not exists signal_outreach_lead_unique
  on signal_outreach (lead_id) where lead_id is not null;

-- --- Alter outreach audit to link lead-driven sends ---
alter table signal_outreach_audit add column if not exists lead_id uuid;

-- --- Real per-workspace timezone (browser-detected on first load; UTC only pre-detection) ---
alter table workspaces add column if not exists timezone text;
