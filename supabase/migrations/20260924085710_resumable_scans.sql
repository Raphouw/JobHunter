-- Durable scan queue. Every worker invocation owns a short lease; a new
-- invocation can resume after expiry without trusting local disk state.
alter table public.hunter_scan_jobs
  add column phase text not null default 'discover'
    check (phase in ('discover', 'analyze', 'finish')),
  add column checkpoint jsonb not null default '{}'::jsonb,
  add column next_run_at timestamptz not null default now(),
  add column lease_token uuid,
  add column lease_until timestamptz,
  add column attempt_count integer not null default 0 check (attempt_count >= 0),
  add column cancel_requested boolean not null default false;

create unique index hunter_scan_one_active_per_profile
  on public.hunter_scan_jobs(profile_id)
  where status in ('queued', 'running');

create index hunter_scan_due_idx
  on public.hunter_scan_jobs(next_run_at, created_at)
  where status in ('queued', 'running');

create table public.hunter_scan_candidates (
  id bigint generated always as identity primary key,
  job_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  canonical_url text not null,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'retry')),
  decision jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (job_id, user_id)
    references public.hunter_scan_jobs(id, user_id) on delete cascade,
  unique (job_id, canonical_url)
);

create index hunter_scan_candidates_pending_idx
  on public.hunter_scan_candidates(job_id, id)
  where status in ('pending', 'retry');

alter table public.hunter_scan_candidates enable row level security;
revoke all on public.hunter_scan_candidates from anon, authenticated;
grant select, insert, update, delete on public.hunter_scan_candidates to service_role;
grant usage, select on sequence public.hunter_scan_candidates_id_seq to service_role;
grant select, update on public.hunter_scan_jobs to service_role;

-- Authenticated users may enqueue only their own profile and request a cancel.
-- They cannot change status, progress, lease, checkpoint or candidate rows.
grant insert (user_id, profile_id, mode) on public.hunter_scan_jobs
  to authenticated;
grant update (cancel_requested) on public.hunter_scan_jobs
  to authenticated;

create policy hunter_scan_jobs_insert on public.hunter_scan_jobs
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy hunter_scan_jobs_request_cancel on public.hunter_scan_jobs
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- Service-role only RPC: one atomic claim even when several invocations race.
create function public.hunter_claim_scan_job(p_job_id uuid default null)
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

create function public.hunter_release_scan_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_phase text,
  p_checkpoint jsonb,
  p_progress_percent integer,
  p_completed boolean default false
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_phase not in ('discover', 'analyze', 'finish')
     or p_progress_percent not between 0 and 100
     or jsonb_typeof(p_checkpoint) <> 'object' then
    raise exception 'Invalid scan checkpoint';
  end if;

  update public.hunter_scan_jobs
  set phase = p_phase,
      checkpoint = p_checkpoint,
      progress_percent = case when p_completed then 100 else p_progress_percent end,
      status = case when p_completed then 'completed' else 'queued' end,
      finished_at = case when p_completed then now() else null end,
      next_run_at = now(),
      lease_token = null,
      lease_until = null
  where id = p_job_id
    and lease_token = p_lease_token
    and lease_until > now()
    and status = 'running'
    and cancel_requested = false;
  return found;
end;
$$;

revoke all on function public.hunter_claim_scan_job(uuid) from public, anon, authenticated;
revoke all on function public.hunter_release_scan_job(uuid, uuid, text, jsonb, integer, boolean)
  from public, anon, authenticated;
grant execute on function public.hunter_claim_scan_job(uuid) to service_role;
grant execute on function public.hunter_release_scan_job(uuid, uuid, text, jsonb, integer, boolean)
  to service_role;
