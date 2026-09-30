-- Fence browser leases from legacy production workers and cron dispatch.
-- Preserve existing leases: their current owner may still be processing them.
create or replace function public.hunter_claim_scan_job(p_job_id uuid default null)
returns setof public.hunter_scan_jobs
language sql
security invoker
set search_path = ''
as $$
  update public.hunter_scan_jobs as j
  set status = 'running',
      started_at = coalesce(j.started_at, now()),
      lease_token = gen_random_uuid(),
      lease_until = now() + interval '4 minutes 40 seconds',
      attempt_count = j.attempt_count + 1
  from (
    select id
    from public.hunter_scan_jobs
    where (p_job_id is null or id = p_job_id)
      and coalesce(checkpoint->>'executor', 'server') <> 'browser'
      and status in ('queued', 'running')
      and cancel_requested = false
      and next_run_at <= now()
      and (lease_until is null or lease_until <= now())
    order by created_at
    for update skip locked
    limit 1
  ) as due
  where j.id = due.id
  returning j.*;
$$;

create or replace function public.hunter_claim_browser_scan_job(p_job_id uuid default null)
returns setof public.hunter_scan_jobs
language sql
security invoker
set search_path = ''
as $$
  update public.hunter_scan_jobs as j
  set status = 'running',
      started_at = coalesce(j.started_at, now()),
      lease_token = gen_random_uuid(),
      lease_until = now() + interval '4 minutes 40 seconds',
      attempt_count = j.attempt_count + 1
  from (
    select id
    from public.hunter_scan_jobs
    where (p_job_id is null or id = p_job_id)
      and checkpoint->>'executor' = 'browser'
      and coalesce((checkpoint->>'paused')::boolean, false) = false
      and status in ('queued', 'running')
      and cancel_requested = false
      and next_run_at <= now()
      and (lease_until is null or lease_until <= now())
    order by created_at
    for update skip locked
    limit 1
  ) as due
  where j.id = due.id
  returning j.*;
$$;

revoke all on function public.hunter_claim_browser_scan_job(uuid) from public, anon, authenticated;
grant execute on function public.hunter_claim_browser_scan_job(uuid) to service_role;

-- Resume a scan shortly after each released slice. The lease check prevents
-- overlapping work on the same job, and idle ticks make no HTTP request.
select cron.unschedule('hunter-worker-every-30-seconds');
select cron.schedule(
  'hunter-worker-every-30-seconds',
  '30 seconds',
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
      where coalesce(checkpoint->>'executor', 'server') <> 'browser'
        and status in ('queued', 'running')
        and (cancel_requested or (next_run_at <= now()
          and (lease_until is null or lease_until <= now())))
      order by created_at
      limit 4
    ) as due
    where exists (select 1 from vault.decrypted_secrets
                  where name = 'hunter_worker_cron_secret');
  $job$
);
