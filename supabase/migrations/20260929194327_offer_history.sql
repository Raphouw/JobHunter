-- Durable URL identity history. Candidate rows may be pruned after 30 days;
-- this compact history remains so reviewed/rejected pages are not downloaded again.
create table public.hunter_offer_history (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid not null,
  identity text not null,
  canonical_url text not null,
  status text not null check (status in ('accepted', 'rejected', 'known')),
  review_decision text not null default 'pending'
    check (review_decision in ('pending', 'keep', 'unsure', 'reject')),
  offer_id bigint references public.hunter_offers(id) on delete set null,
  title text not null default '',
  company text not null default '',
  location text not null default '',
  decision jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  foreign key (profile_id, user_id)
    references public.hunter_profiles(id, user_id) on delete cascade,
  unique (profile_id, identity)
);

create index hunter_offer_history_profile_title_idx
  on public.hunter_offer_history(profile_id, company, title);

-- Existing retained offers get an immediate URL cache entry.
insert into public.hunter_offer_history
  (user_id, profile_id, identity, canonical_url, status, review_decision,
   offer_id, title, company, location, fetched_at)
select o.user_id, o.profile_id, o.canonical_url, o.canonical_url, 'accepted',
       o.review_decision, o.id, o.title, o.company, o.location, o.discovered_at
from public.hunter_offers as o
on conflict (profile_id, identity) do nothing;

-- Recover examined rejects that are still present in scan candidate history.
insert into public.hunter_offer_history
  (user_id, profile_id, identity, canonical_url, status, title, decision, fetched_at)
select distinct on (j.profile_id, c.identity)
       c.user_id, j.profile_id, c.identity, c.canonical_url, 'rejected',
       coalesce(c.decision->>'title', c.payload->>'title', ''),
       c.decision, c.updated_at
from public.hunter_scan_candidates as c
join public.hunter_scan_jobs as j on j.id = c.job_id
where c.status = 'rejected'
  and c.decision->'fetch'->>'status' is not null
order by j.profile_id, c.identity, c.updated_at desc
on conflict (profile_id, identity) do nothing;

alter table public.hunter_offer_history enable row level security;
revoke all on public.hunter_offer_history from anon, authenticated;
grant select on public.hunter_offer_history to authenticated;
grant select, insert, update on public.hunter_offer_history to service_role;
grant usage, select on sequence public.hunter_offer_history_id_seq to service_role;

create policy hunter_offer_history_select on public.hunter_offer_history
  for select to authenticated
  using (user_id = (select auth.uid()));
