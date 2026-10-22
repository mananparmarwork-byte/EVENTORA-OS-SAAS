-- ============================================================================
-- Eventora OS — SQL file 9 (OPTIONAL, after the send-reminders function is deployed):
-- sends the renewal reminder emails automatically every morning (9:00 India time).
-- 1) Supabase -> Database -> Extensions: enable  pg_cron  and  pg_net.
-- 2) Replace <PROJECT-REF> and <CRON-SECRET> below (the secret must equal the CRON_SECRET you set for the function).
-- 3) Run it. To stop it later:  select cron.unschedule('eventora-reminders');
-- ============================================================================
select cron.schedule(
  'eventora-reminders',
  '30 3 * * *',
  $$ select net.http_post(
       url := 'https://<PROJECT-REF>.supabase.co/functions/v1/send-reminders',
       headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON-SECRET>'),
       body := '{}'::jsonb) $$
);
