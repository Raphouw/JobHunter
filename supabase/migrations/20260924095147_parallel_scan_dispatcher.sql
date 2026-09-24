-- Independent profiles can progress concurrently; the claim RPC and the
-- one-active-job-per-profile index keep each individual scan serial.
select cron.unschedule('hunter-worker-every-minute');
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
      body := jsonb_build_object('job_id', due.id),
      timeout_milliseconds := 290000
    )
    from (
      select id from public.hunter_scan_jobs
      where status in ('queued', 'running')
        and (cancel_requested or (next_run_at <= now()
          and (lease_until is null or lease_until <= now())))
      order by created_at
      limit 4
    ) as due
    where exists (select 1 from vault.decrypted_secrets
                  where name = 'hunter_worker_cron_secret');
  $job$
);
