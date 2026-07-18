-- Phase 6: CRM groundwork.
-- 1) Drop the orphaned lead_catalog table: zero code references, the shared
--    cross-workspace catalog design was never wired (rebuild later if scale
--    economics demand it - product decision 2026-07-17).
-- 2) crm_contacts: one unified read model over both prospect stores
--    (scraped/imported directory leads + post engagers). security_invoker so
--    each caller sees only their workspace via the underlying RLS.
drop table if exists lead_catalog;

create or replace view crm_contacts
with (security_invoker = true) as
select
  l.id,
  l.workspace_id,
  'directory'::text as origin,
  l.company_name as name,
  l.tagline as headline,
  l.lead_status as status,
  l.nurture_stage,
  l.conversion_stage,
  l.created_at,
  l.updated_at
from signal_leads l
union all
select
  w.id,
  w.workspace_id,
  'engager'::text as origin,
  w.display_name as name,
  w.headline,
  w.status,
  null::text as nurture_stage,
  null::text as conversion_stage,
  w.created_at,
  w.updated_at
from warm_contacts w;
