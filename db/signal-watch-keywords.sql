-- db/signal-watch-keywords.sql
-- Task 6: workspace-level watchlist keywords, merged into accelerator classification.

alter table signal_directory_settings
  add column if not exists custom_keywords jsonb not null default '[]';
