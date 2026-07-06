-- GTM nurture pipeline: per-lead playbooks, stages, and engagement task links.
-- Apply after signals-leads.sql + engagement-analytics.sql:
--   npx @insforge/cli db query "$(sed '/^--/d' db/gtm-nurture.sql | tr '\n' ' ')"

alter table signal_leads
  add column if not exists nurture_stage text not null default 'discovered';

alter table signal_leads
  add column if not exists playbook jsonb;

alter table signal_leads
  add column if not exists next_action_at timestamptz;

do $$ begin
  alter table signal_leads
    add constraint signal_leads_nurture_stage_check
    check (nurture_stage in (
      'discovered', 'planned', 'engaging', 'connect_ready',
      'connect_sent', 'nurturing', 'dm_ready', 'dm_sent', 'replied', 'closed'
    ));
exception when duplicate_object then null;
end $$;

create index if not exists signal_leads_nurture_due
  on signal_leads (workspace_id, nurture_stage, next_action_at)
  where nurture_stage in ('connect_ready', 'dm_ready');

alter table engagement_tasks
  add column if not exists lead_id uuid references signal_leads(id) on delete set null;

alter table engagement_tasks
  add column if not exists workspace_id uuid;

create index if not exists engagement_tasks_lead on engagement_tasks (lead_id);
