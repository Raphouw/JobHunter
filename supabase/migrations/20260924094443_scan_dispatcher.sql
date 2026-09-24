-- No request is sent while there is no due scan or until the shared cron
-- secret has been placed in Supabase Vault under hunter_worker_cron_secret.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'hunter-worker-every-minute',
  '* * * * *',
  $job$
    select net.http_post(
      url := 'https://job-hunter-three-chi.vercel.app/api/scan',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret from vault.decrypted_secrets
          where name = 'hunter_worker_cron_secret' limit 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 290000
    )
    where exists (
      select 1 from public.hunter_scan_jobs
      where status in ('queued', 'running')
        and (
          cancel_requested or (next_run_at <= now()
            and (lease_until is null or lease_until <= now()))
        )
    )
    and exists (select 1 from vault.decrypted_secrets
                where name = 'hunter_worker_cron_secret');
  $job$
);
