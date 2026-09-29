-- Keep unexamined and inaccessible candidates separate from examined rejects.
-- Applied through the Supabase migration tool as version 20260929135126.
-- Keep this file aligned with the remote migration history.
alter table public.hunter_scan_candidates
  drop constraint hunter_scan_candidates_status_check;

alter table public.hunter_scan_candidates
  add constraint hunter_scan_candidates_status_check
  check (status in ('pending', 'deferred', 'retry', 'accepted', 'known', 'filtered',
                   'rejected', 'unavailable', 'unexamined'));

alter table public.hunter_scan_candidates
  add column identity text,
  add column priority integer not null default 0,
  add column next_attempt_at timestamptz not null default now();

update public.hunter_scan_candidates set identity = canonical_url where identity is null;
alter table public.hunter_scan_candidates alter column identity set not null;
create unique index hunter_scan_candidates_job_identity_idx
  on public.hunter_scan_candidates(job_id, identity);

drop index public.hunter_scan_candidates_pending_idx;
create index hunter_scan_candidates_pending_idx
  on public.hunter_scan_candidates(job_id, next_attempt_at, priority desc, id)
  where status in ('pending', 'deferred', 'retry');

-- Reuse the existing RPC signature; a checkpoint may request a bounded pause
-- when every candidate is cooling down. The claim still remains atomic.
create or replace function public.hunter_release_scan_job(
  p_job_id uuid, p_lease_token uuid, p_phase text, p_checkpoint jsonb,
  p_progress_percent integer, p_completed boolean default false
)
returns boolean
language plpgsql security invoker set search_path = ''
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
      next_run_at = now() + make_interval(secs =>
        greatest(0, least(300, coalesce((p_checkpoint->>'retry_delay_seconds')::integer, 0)))),
      lease_token = null, lease_until = null
  where id = p_job_id and lease_token = p_lease_token and lease_until > now()
    and status = 'running' and cancel_requested = false;
  return found;
end;
$$;

-- Preserve job summaries and offers; only per-candidate payloads and verbose
-- events of terminal jobs older than 30 days are eligible for pruning.
create function public.hunter_prune_scan_history()
returns table(candidates_deleted bigint, events_deleted bigint)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  delete from public.hunter_scan_candidates as c
  using public.hunter_scan_jobs as j
  where c.job_id = j.id and j.status in ('completed', 'failed', 'cancelled')
    and j.finished_at < now() - interval '30 days';
  get diagnostics candidates_deleted = row_count;
  delete from public.hunter_scan_events as e
  using public.hunter_scan_jobs as j
  where e.job_id = j.id and j.status in ('completed', 'failed', 'cancelled')
    and j.finished_at < now() - interval '30 days';
  get diagnostics events_deleted = row_count;
  return next;
end;
$$;

revoke all on function public.hunter_prune_scan_history() from public, anon, authenticated;
grant execute on function public.hunter_prune_scan_history() to service_role;

-- One lease-guarded write for a complete analysis lot. A stale worker cannot
-- overwrite decisions made by a later lease holder.
create function public.hunter_apply_scan_decisions(
  p_job_id uuid, p_lease_token uuid, p_rows jsonb
)
returns integer
language plpgsql security invoker set search_path = ''
as $$
declare changed integer;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 100 then
    raise exception 'Invalid scan decision batch';
  end if;
  -- Serialize this decision write with a competing claim or cancellation.
  -- FOR UPDATE rechecks the lease after waiting for a concurrent transaction.
  perform 1 from public.hunter_scan_jobs
    where id = p_job_id and lease_token = p_lease_token
      and lease_until > clock_timestamp() and status = 'running' and cancel_requested = false
    for update;
  if not found then return 0; end if;
  update public.hunter_scan_candidates as c
  set status = x.status, decision = x.decision,
      next_attempt_at = x.next_attempt_at, updated_at = now()
  from jsonb_to_recordset(p_rows) as x(
    id bigint, status text, decision jsonb, next_attempt_at timestamptz
  )
  where c.id = x.id and c.job_id = p_job_id
    and c.user_id = (select user_id from public.hunter_scan_jobs where id = p_job_id);
  get diagnostics changed = row_count;
  return changed;
end;
$$;

revoke all on function public.hunter_apply_scan_decisions(uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.hunter_apply_scan_decisions(uuid, uuid, jsonb) to service_role;
