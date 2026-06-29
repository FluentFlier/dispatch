-- pg_cron setup: moves calendar-sync, auto-generate, intelligence-sync off Vercel
-- to stay within the Hobby plan 2-cron limit.
--
-- STEP 1 — run these two lines in your InsForge SQL editor (replace with real values):
--   ALTER DATABASE postgres SET app.base_url = 'https://your-app.vercel.app';
--   ALTER DATABASE postgres SET app.cron_secret = 'your-cron-secret-here';
--
-- STEP 2 — run the rest of this file.
--
-- Verify afterward:
--   SELECT jobid, jobname, schedule FROM cron.job ORDER BY jobname;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Idempotent: unschedule before re-registering so re-runs are safe.
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname IN ('calendar-sync', 'auto-generate', 'intelligence-sync');

-- calendar-sync: hourly (mirrors former Vercel cron '0 * * * *')
SELECT cron.schedule(
  'calendar-sync',
  '0 * * * *',
  $job$
  SELECT net.http_get(
    url     := current_setting('app.base_url') || '/api/cron/calendar-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.cron_secret')
    )
  );
  $job$
);

-- auto-generate: daily 8 AM UTC (mirrors former Vercel cron '0 8 * * *')
SELECT cron.schedule(
  'auto-generate',
  '0 8 * * *',
  $job$
  SELECT net.http_get(
    url     := current_setting('app.base_url') || '/api/cron/auto-generate',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.cron_secret')
    )
  );
  $job$
);

-- intelligence-sync: daily 2 AM UTC (mirrors former Vercel cron '0 2 * * *')
SELECT cron.schedule(
  'intelligence-sync',
  '0 2 * * *',
  $job$
  SELECT net.http_get(
    url     := current_setting('app.base_url') || '/api/cron/intelligence-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.cron_secret')
    )
  );
  $job$
);

-- Confirm all three are registered
SELECT jobid, jobname, schedule, active FROM cron.job ORDER BY jobname;
