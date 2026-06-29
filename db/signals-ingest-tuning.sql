-- Signals ingest tuning (apply after signals.sql)
-- Slower default polling + cost-conscious floor

alter table signal_sources alter column poll_interval_minutes set default 30;

update signal_safety_settings
set min_poll_interval_minutes = 30
where min_poll_interval_minutes < 30;

update signal_sources
set poll_interval_minutes = 30
where poll_interval_minutes < 30;
