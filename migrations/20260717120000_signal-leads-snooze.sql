-- Real snooze for leads: the feed hides a lead until snoozed_until passes.
-- Previously snooze only pushed digest_date, which the feed never reads.
alter table signal_leads add column if not exists snoozed_until timestamptz;
