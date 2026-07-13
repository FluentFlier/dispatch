-- Workspace booking link for outreach replies (Calendly, Google Calendar, etc.)
alter table signal_directory_settings
  add column if not exists meeting_link text;

comment on column signal_directory_settings.meeting_link is
  'User-provided scheduling URL injected into reply/DM drafts when booking a call.';
