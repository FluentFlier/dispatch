create table if not exists signal_integrations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  toolkit text not null check (toolkit in ('slack', 'gmail', 'googlecalendar')),
  composio_user_id text not null,
  connected_by_user_id uuid,
  enabled boolean not null default true,
  config jsonb not null default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (workspace_id, toolkit)
);

create index if not exists signal_integrations_workspace on signal_integrations (workspace_id);

alter table signal_outreach drop constraint if exists signal_outreach_channel_check;
alter table signal_outreach add constraint signal_outreach_channel_check
  check (channel in ('linkedin_connect', 'linkedin_dm', 'x_dm', 'copy', 'gmail'));
