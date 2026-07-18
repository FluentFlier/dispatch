-- db/signal-profile-fields.sql
-- Component G: generalized profile/company snapshot diffing.

alter table signal_profile_snapshots
  add column if not exists description text;

-- Widen the signal_type check constraint to include field_change.
alter table signal_events
  drop constraint if exists signal_events_signal_type_check;

alter table signal_events
  add constraint signal_events_signal_type_check
    check (signal_type in ('accelerator_join', 'funding_round', 'role_change', 'launch', 'other', 'keyword_match', 'field_change'));
