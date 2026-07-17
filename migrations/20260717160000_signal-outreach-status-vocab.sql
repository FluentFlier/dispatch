-- Phase-5 review finding (pre-existing prod bug): setLeadOutreachStatus writes
-- 'accepted' / 'replied' / 'closed' (OUTREACH_STAGE_ORDER), but the status
-- check constraint only allowed the draft/send vocabulary - so the
-- check-connection and outreach-stage routes threw on every lifecycle advance.
alter table signal_outreach drop constraint if exists signal_outreach_status_check;
alter table signal_outreach add constraint signal_outreach_status_check
  check (status in ('draft', 'approved', 'sent', 'failed', 'dismissed', 'accepted', 'replied', 'closed'));
