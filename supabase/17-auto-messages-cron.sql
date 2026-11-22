-- ============================================================================
-- Eventora OS — SQL file 17 (OPTIONAL): run the automatic reminders (Super admin -> Automation) every morning at 9:00 India time.
--
-- You do NOT need this for in-app reminders: they are also checked whenever an owner opens the app.
-- You need it only if you want reminders to be created (and e-mailed, see the send-message-emails function) even when the
-- owner has not opened the app that day.
--
-- 1) Supabase -> Database -> Extensions: enable  pg_cron.
-- 2) Run this file. To stop it later:  select cron.unschedule('eventora-auto-messages');
-- ============================================================================
select cron.schedule(
  'eventora-auto-messages',
  '30 3 * * *',                                   -- 03:30 UTC = 09:00 India
  $$ select public._run_auto_messages() $$
);

-- Optional: e-mail the messages that asked for e-mail, every 15 minutes (needs pg_net + the send-message-emails function + its secrets).
-- Replace <PROJECT-REF> and <CRON-SECRET> (the secret must equal CRON_SECRET of the function), then remove the two leading dashes of each line:
-- select cron.schedule('eventora-message-emails', '*/15 * * * *', $$ select net.http_post(
--   url := 'https://<PROJECT-REF>.supabase.co/functions/v1/send-message-emails',
--   headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', '<CRON-SECRET>'),
--   body := '{}'::jsonb) $$);
