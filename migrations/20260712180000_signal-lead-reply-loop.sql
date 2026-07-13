-- Reply loop: store LinkedIn thread messages and flag leads needing a response.
-- Apply after gtm-nurture.sql + signals-leads.sql.

alter table signal_leads
  add column if not exists needs_reply boolean not null default false;

alter table signal_leads
  add column if not exists unipile_chat_id text;

alter table signal_leads
  add column if not exists last_inbound_at timestamptz;

alter table signal_leads
  add column if not exists conversion_stage text;

do $$ begin
  alter table signal_leads
    add constraint signal_leads_conversion_stage_check
    check (conversion_stage is null or conversion_stage in (
      'interested', 'meeting_booked', 'not_now', 'won', 'lost'
    ));
exception when duplicate_object then null;
end $$;

create index if not exists signal_leads_needs_reply
  on signal_leads (workspace_id, needs_reply, last_inbound_at desc)
  where needs_reply = true;

create table if not exists signal_lead_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  lead_id uuid not null references signal_leads(id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  channel text not null default 'linkedin_dm'
    check (channel in ('linkedin_dm', 'x_dm', 'gmail')),
  body text not null,
  external_message_id text,
  chat_id text,
  sender_provider_id text,
  sent_at timestamptz not null default now(),
  created_at timestamptz default now()
);

create unique index if not exists signal_lead_messages_external_unique
  on signal_lead_messages (external_message_id)
  where external_message_id is not null;

create index if not exists signal_lead_messages_lead_sent
  on signal_lead_messages (lead_id, sent_at);

create index if not exists signal_lead_messages_workspace
  on signal_lead_messages (workspace_id, sent_at desc);
