-- Hosted operation: deliver in-app reminders every five minutes. Does not send
-- email or delete Storage objects. No credentials in the scheduled command.
create extension if not exists pg_cron;
select cron.schedule(
  'psi-pilot-reminders',
  '*/5 * * * *',
  'select public.worker_process_due_reminders(50);'
);
