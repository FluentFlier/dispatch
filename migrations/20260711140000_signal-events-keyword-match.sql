-- Allow 'keyword_match' as a signal_events.signal_type.
-- Keyword monitoring (source_type = 'keyword_search') surfaces "author just
-- posted about <keyword>" events; these bypass the GTM classifier and need
-- their own type so the feed can label/filter them distinctly from GTM signals.
-- Idempotent: DROP IF EXISTS + re-add.

ALTER TABLE signal_events DROP CONSTRAINT IF EXISTS signal_events_signal_type_check;
ALTER TABLE signal_events ADD CONSTRAINT signal_events_signal_type_check
  CHECK (signal_type IN ('accelerator_join', 'funding_round', 'role_change', 'launch', 'other', 'keyword_match'));
