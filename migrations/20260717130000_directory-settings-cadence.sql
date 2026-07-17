-- Phase 3: assistant-driven setup + scrape cadence.
-- discovery_goal: the parsed natural-language hunt goal (stage/vertical/geo),
-- consumed by web discovery so constraints like "in NYC" stop being dropped.
-- scrape_frequency: how often the cron may scrape for this workspace, so users
-- control credit spend. last_synced_at: stamped after every directory sync.
alter table signal_directory_settings add column if not exists discovery_goal text;
alter table signal_directory_settings add column if not exists scrape_frequency text not null default 'daily';
alter table signal_directory_settings add column if not exists last_synced_at timestamptz;
alter table signal_directory_settings drop constraint if exists signal_directory_settings_scrape_frequency_check;
alter table signal_directory_settings add constraint signal_directory_settings_scrape_frequency_check
  check (scrape_frequency in ('daily', 'every_3_days', 'weekly', 'manual'));
