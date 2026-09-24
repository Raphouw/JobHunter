-- Job Hunter cloud foundation. Run in a dedicated Supabase project.
-- The browser receives only the publishable key; worker credentials stay server-side.

create table public.hunter_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);

create index hunter_profiles_user_id_idx on public.hunter_profiles(user_id);

create table public.hunter_offers (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid not null,
  url text not null,
  canonical_url text not null,
  title text not null default '',
  company text not null default '',
  location text not null default '',
  canton text not null default '',
  source text not null default '',
  snippet text not null default '',
  body text not null default '',
  language text not null default '',
  duration text not null default '',
  start_date text not null default '',
  domain_category text not null default '',
  skills_found text not null default '',
  score numeric(5,1) not null default 0,
  confidence numeric(5,1) not null default 0,
  reasons text not null default '',
  availability_status text not null default 'unknown',
  review_decision text not null default 'pending'
    check (review_decision in ('pending', 'keep', 'unsure', 'reject')),
  reviewed_at timestamptz,
  discovered_at timestamptz not null default now(),
  foreign key (profile_id, user_id)
    references public.hunter_profiles(id, user_id) on delete cascade,
  unique (profile_id, canonical_url)
);

create index hunter_offers_queue_idx
  on public.hunter_offers(profile_id, review_decision, score desc);

create table public.hunter_scan_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid not null,
  mode text not null check (mode in ('Rapide', 'Complet', 'Maximum', 'Exhaustif 1h')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  progress_percent integer not null default 0 check (progress_percent between 0 and 100),
  summary jsonb not null default '{}'::jsonb,
  error_message text,
  foreign key (profile_id, user_id)
    references public.hunter_profiles(id, user_id) on delete cascade,
  unique (id, user_id)
);

create index hunter_scan_jobs_user_created_idx
  on public.hunter_scan_jobs(user_id, created_at desc);

create table public.hunter_scan_events (
  id bigint generated always as identity primary key,
  job_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  level text not null default 'info',
  message text not null,
  foreign key (job_id, user_id)
    references public.hunter_scan_jobs(id, user_id) on delete cascade
);

create index hunter_scan_events_job_idx on public.hunter_scan_events(job_id, id);

alter table public.hunter_profiles enable row level security;
alter table public.hunter_offers enable row level security;
alter table public.hunter_scan_jobs enable row level security;
alter table public.hunter_scan_events enable row level security;

revoke all on public.hunter_profiles, public.hunter_offers,
  public.hunter_scan_jobs, public.hunter_scan_events from anon, authenticated;
grant usage on schema public to authenticated;
grant select, insert on public.hunter_profiles to authenticated;
grant update (name, config) on public.hunter_profiles to authenticated;
grant delete on public.hunter_profiles to authenticated;
grant select on public.hunter_offers to authenticated;
grant update (review_decision, reviewed_at) on public.hunter_offers to authenticated;
grant select on public.hunter_scan_jobs, public.hunter_scan_events to authenticated;

create policy hunter_profiles_select on public.hunter_profiles
  for select to authenticated using (user_id = (select auth.uid()));
create policy hunter_profiles_insert on public.hunter_profiles
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy hunter_profiles_update on public.hunter_profiles
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy hunter_profiles_delete on public.hunter_profiles
  for delete to authenticated using (user_id = (select auth.uid()));

create policy hunter_offers_select on public.hunter_offers
  for select to authenticated using (user_id = (select auth.uid()));
create policy hunter_offers_review on public.hunter_offers
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy hunter_scan_jobs_select on public.hunter_scan_jobs
  for select to authenticated using (user_id = (select auth.uid()));
create policy hunter_scan_events_select on public.hunter_scan_events
  for select to authenticated using (user_id = (select auth.uid()));

-- Scan jobs, offers, and events are created by the future worker with a
-- server-side service credential. No browser write permission is granted.
