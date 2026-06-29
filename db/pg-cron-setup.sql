-- pg_cron setup: calendar-sync, auto-generate, intelligence-sync
--
-- BEFORE RUNNING:
--   1. Enable pg_cron and pg_net in InsForge dashboard (Extensions tab)
--   2. Fill in your real values in the INSERT below

-- Config table (created once, safe to re-run)
CREATE TABLE IF NOT EXISTS app_config (
  key   text PRIMARY KEY,
  value text NOT NULL
);

-- Set your actual app URL and cron secret here
INSERT INTO app_config (key, value) VALUES
  ('base_url',    'https://YOUR_APP_URL_HERE'),
  ('cron_secret', 'YOUR_CRON_SECRET_HERE')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Idempotent: remove existing jobs before re-registering
SELECT cron.unschedule('calendar-sync')     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'calendar-sync');
SELECT cron.unschedule('auto-generate')     WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-generate');
SELECT cron.unschedule('intelligence-sync') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'intelligence-sync');

-- calendar-sync: hourly
SELECT cron.schedule(
  'calendar-sync',
  '0 * * * *',
  $job$
  SELECT net.http_get(
    url     := (SELECT value FROM app_config WHERE key = 'base_url') || '/api/cron/calendar-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT value FROM app_config WHERE key = 'cron_secret')
    )
  );
  $job$
);

-- auto-generate: daily 8 AM UTC
SELECT cron.schedule(
  'auto-generate',
  '0 8 * * *',
  $job$
  SELECT net.http_get(
    url     := (SELECT value FROM app_config WHERE key = 'base_url') || '/api/cron/auto-generate',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT value FROM app_config WHERE key = 'cron_secret')
    )
  );
  $job$
);

-- intelligence-sync: daily 2 AM UTC
SELECT cron.schedule(
  'intelligence-sync',
  '0 2 * * *',
  $job$
  SELECT net.http_get(
    url     := (SELECT value FROM app_config WHERE key = 'base_url') || '/api/cron/intelligence-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT value FROM app_config WHERE key = 'cron_secret')
    )
  );
  $job$
);

-- Verify
SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobname;
