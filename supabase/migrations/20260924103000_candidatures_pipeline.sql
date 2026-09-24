-- Candidatures application tracking pipeline
-- Stores applications with statuses, timeline history, and post-it notes.

create table if not exists public.hunter_candidatures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  profile_id uuid not null,
  offer_id bigint references public.hunter_offers(id) on delete set null,
  company text not null default '',
  canton text not null default '',
  location text not null default '',
  sector text not null default '',
  detailed_activity text not null default '',
  link1 text not null default '',
  link2 text not null default '',
  link3 text not null default '',
  demarche text not null default '',
  rating numeric(3,1) not null default 0,
  status text not null default 'Demande initiale',
  contact_email text not null default '',
  status_history jsonb not null default '[]'::jsonb,
  notes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (profile_id, user_id)
    references public.hunter_profiles(id, user_id) on delete cascade
);

create index if not exists hunter_candidatures_user_profile_idx
  on public.hunter_candidatures(user_id, profile_id, created_at desc);

create index if not exists hunter_candidatures_status_idx
  on public.hunter_candidatures(profile_id, status);

alter table public.hunter_candidatures enable row level security;

revoke all on public.hunter_candidatures from anon, authenticated;
grant usage on schema public to authenticated;
grant select, insert, update, delete on public.hunter_candidatures to authenticated;

create policy hunter_candidatures_select on public.hunter_candidatures
  for select to authenticated using (user_id = (select auth.uid()));

create policy hunter_candidatures_insert on public.hunter_candidatures
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy hunter_candidatures_update on public.hunter_candidatures
  for update to authenticated using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy hunter_candidatures_delete on public.hunter_candidatures
  for delete to authenticated using (user_id = (select auth.uid()));
