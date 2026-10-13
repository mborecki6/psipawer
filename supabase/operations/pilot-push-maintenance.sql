-- Hosted operation. Apply only after the production maintenance handler and
-- VAPID configuration are deployed, and the matching MAINTENANCE_SECRET has
-- been stored separately in Vault as psi_maintenance_secret.
-- Keep psi-pilot-reminders: its database-only job remains the inbox fallback.
-- Preflight: net/vault must not be exposed through the Data API. Direct DB
-- login roles must be trusted: pg_net briefly queues Authorization in plaintext.
begin;

-- Refuse to install or reschedule the job without exactly one valid secret.
-- Neither the stored cron command nor its errors include the secret value.
do $preflight$
declare
  maintenance_secret text;
  secret_count bigint;
begin
  select count(*), min(decrypted_secret)
    into secret_count, maintenance_secret
    from vault.decrypted_secrets
    where name = 'psi_maintenance_secret';
  if secret_count <> 1 or maintenance_secret is null
    or maintenance_secret !~ '^[A-Za-z0-9_-]{43,128}$' then
    raise exception 'Push maintenance secret unavailable';
  end if;
end;
$preflight$;

create extension if not exists pg_net;

-- Reusing this name as the same database owner updates the existing job.
select cron.schedule(
  'psi-pilot-push',
  '* * * * *',
  $job$
    do $run$
    declare
      maintenance_secret text;
      secret_count bigint;
    begin
      select count(*), min(decrypted_secret)
        into secret_count, maintenance_secret
        from vault.decrypted_secrets
        where name = 'psi_maintenance_secret';
      if secret_count <> 1 or maintenance_secret is null
        or maintenance_secret !~ '^[A-Za-z0-9_-]{43,128}$' then
        raise exception 'Push maintenance secret unavailable';
      end if;

      perform net.http_post(
        url := 'https://psipawer.vercel.app/api/internal/maintenance',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || maintenance_secret
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 60000
      );
    end;
    $run$;
  $job$
);

commit;
