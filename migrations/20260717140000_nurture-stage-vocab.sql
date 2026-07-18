-- Phase 5: single coherent nurture stage vocabulary.
-- 'nurturing' was dead (never written by any code path) - removed.
-- 'in_conversation' added: the prospect replied ('replied', inbound) vs you
-- replied back ('in_conversation', outbound) were both stamped 'replied',
-- making the stage ambiguous. Also adds edited_draft_text for draft autosave
-- (user edits persist separately from the model draft, which stays the
-- before-side of the edit-learning pair).
alter table signal_leads drop constraint if exists signal_leads_nurture_stage_check;
alter table signal_leads
  add constraint signal_leads_nurture_stage_check
  check (nurture_stage in (
    'discovered', 'planned', 'engaging', 'connect_ready', 'connect_sent',
    'dm_ready', 'dm_sent', 'replied', 'in_conversation', 'closed'
  ));

alter table signal_outreach add column if not exists edited_draft_text text;
